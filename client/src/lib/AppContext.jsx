import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api';

const AppContext = createContext({ config: null, loading: true });

export function AppProvider({ children }) {
  const [state, setState] = useState({ config: null, loading: true, error: null });
  useEffect(() => {
    api
      .get('/config')
      .then((r) => setState({ config: r.data, loading: false, error: null }))
      .catch((e) => setState({ config: null, loading: false, error: e }));
  }, []);
  return <AppContext.Provider value={state}>{children}</AppContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useApp = () => useContext(AppContext);
