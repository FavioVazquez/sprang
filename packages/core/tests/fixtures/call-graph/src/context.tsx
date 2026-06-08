import { createContext } from 'react';

const ThemeContext = createContext('light');

export function ThemeProvider({ children }: { children: unknown }) {
  return <ThemeContext.Provider value="dark">{children}</ThemeContext.Provider>;
}
