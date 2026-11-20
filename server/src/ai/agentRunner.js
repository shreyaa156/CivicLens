import { FunctionCallingConfigMode } from '@google/genai';

export class AgentError extends Error {
  constructor(agent, message, cause) {
    super(message);
    this.agent = agent;
    this.cause = cause;
  }
}

const truncate = (value, max = 4000) => {
  const s = JSON.stringify(value);
  return s && s.length > max ? JSON.parse(JSON.stringify({ truncated: true, preview: s.slice(0, max) })) : value;
};

/**
 * Generic Gemini function-calling loop used by both agents.
 *
 *  - The model is forced (mode ANY) to act through declared functions every turn.
 *  - Non-final tool calls are executed by the backend (real DB queries / deterministic maths)
 *    and their results are fed back as functionResponse parts.
 *  - The agent finishes by calling `finalTool`; its args are validated with a zod schema.
 *    Invalid args are returned to the model as an error so it can self-correct.
 *  - `requiredTools` must have been called before the final tool is accepted.
 *
 * @returns {{ output, toolCalls, turns }}
 */
export async function runAgentLoop({
  client,
  agent,
  systemInstruction,
  userParts,
  tools,
  finalTool,
  finalSchema,
  requiredTools = [],
  maxTurns = 8,
  log,
}) {
  const declarations = [...Object.values(tools).map((t) => t.declaration), finalTool.declaration];
  const contents = [{ role: 'user', parts: userParts }];
  const called = new Set();
  const toolCalls = [];
  let finalAttempts = 0;

  for (let turn = 1; turn <= maxTurns; turn++) {
    const started = Date.now();
    let response;
    try {
      response = await client.generateContent(
        {
          contents,
          config: {
            systemInstruction,
            tools: [{ functionDeclarations: declarations }],
            toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } },
          },
        },
        {
          onRetry: (err, attempt, delay) =>
            log({ agent, step: 'model_retry', status: 'warning', message: `Model call failed (${err.status || err.name || 'error'}); retry ${attempt} in ${delay}ms`, data: { error: String(err.message || err).slice(0, 300) } }),
          onFallback: (from, to, err) =>
            log({ agent, step: 'model_fallback', status: 'warning', message: `Model ${from} unavailable (${err.status || err.name}); switched to fallback model ${to}`, data: { from, to } }),
        },
      );
    } catch (err) {
      throw new AgentError(agent, `Model request failed: ${err.status ? `HTTP ${err.status}` : err.message}`, err);
    }

    const calls = response?.functionCalls || [];
    const modelContent = response?.candidates?.[0]?.content;
    log({
      agent,
      step: 'model_turn',
      status: 'info',
      message: calls.length ? `Model turn ${turn}: requested ${calls.map((c) => c.name).join(', ')}` : `Model turn ${turn}: no function call returned`,
      durationMs: Date.now() - started,
      data: { turn, functionCalls: calls.map((c) => c.name), finishReason: response?.candidates?.[0]?.finishReason },
    });

    if (!calls.length) {
      if (!modelContent) {
        const reason = response?.promptFeedback?.blockReason || response?.candidates?.[0]?.finishReason || 'empty response';
        throw new AgentError(agent, `Model returned no usable content (${reason}).`);
      }
      contents.push(modelContent);
      contents.push({ role: 'user', parts: [{ text: `You must respond by calling one of the declared functions. Call ${finalTool.declaration.name} when your analysis is complete.` }] });
      continue;
    }

    // Preserve the model's turn verbatim (keeps thought signatures required by newer Gemini models).
    contents.push(modelContent || { role: 'model', parts: calls.map((c) => ({ functionCall: c })) });

    const responseParts = [];
    for (const call of calls) {
      const args = call.args || {};
      if (call.name === finalTool.declaration.name) {
        const missing = requiredTools.filter((t) => !called.has(t));
        if (missing.length) {
          log({ agent, step: 'guardrail', status: 'warning', message: `Rejected early submission: must call ${missing.join(', ')} first`, data: { missing } });
          responseParts.push(fnResponse(call, { error: `Submission rejected. You must call ${missing.join(', ')} before ${call.name}.` }));
          continue;
        }
        const parsed = finalSchema.safeParse(args);
        if (!parsed.success) {
          finalAttempts++;
          const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
          log({ agent, step: 'validation_failed', status: 'warning', message: `Structured output failed validation (attempt ${finalAttempts})`, data: { issues, args: truncate(args) } });
          if (finalAttempts >= 3) throw new AgentError(agent, `Structured output invalid after ${finalAttempts} attempts: ${issues.join('; ')}`);
          responseParts.push(fnResponse(call, { error: 'Validation failed. Fix these fields and call again.', issues }));
          continue;
        }
        log({ agent, step: 'structured_output', status: 'success', message: `Structured output accepted via ${call.name}`, data: truncate(parsed.data) });
        return { output: parsed.data, toolCalls, turns: turn };
      }

      const tool = tools[call.name];
      if (!tool) {
        responseParts.push(fnResponse(call, { error: `Unknown function ${call.name}` }));
        continue;
      }
      const t0 = Date.now();
      log({ agent, step: `tool_call:${call.name}`, status: 'info', message: `Calling tool ${call.name}`, data: { args: truncate(args, 1000) } });
      let result;
      try {
        result = await tool.handler(args);
        called.add(call.name);
      } catch (err) {
        result = { error: err.message };
      }
      toolCalls.push({ name: call.name, args, result });
      log({
        agent,
        step: `tool_result:${call.name}`,
        status: result?.error ? 'warning' : 'success',
        message: tool.summarise ? tool.summarise(result, args) : `Tool ${call.name} returned`,
        durationMs: Date.now() - t0,
        data: truncate(result),
      });
      responseParts.push(fnResponse(call, result));
    }
    contents.push({ role: 'user', parts: responseParts });
  }
  throw new AgentError(agent, `Agent did not finish within ${maxTurns} turns.`);
}

function fnResponse(call, result) {
  return { functionResponse: { ...(call.id ? { id: call.id } : {}), name: call.name, response: result && typeof result === 'object' && !Array.isArray(result) ? result : { result } } };
}
