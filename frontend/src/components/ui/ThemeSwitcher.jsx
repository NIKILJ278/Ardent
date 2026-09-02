import { useTheme } from '../../context/ThemeContext';

const COLORS = { light: '#1E40AF', dark: '#0F172A', ocean: '#0E7490', forest: '#15803D' };

export default function ThemeSwitcher() {
  const { theme, setTheme, themes } = useTheme();
  return (
    <div className="theme-switcher" title="Switch theme">
      {themes.map(t => (
        <button
          key={t}
          className={`theme-pill${theme === t ? ' active' : ''}`}
          style={{ background: COLORS[t] }}
          onClick={() => setTheme(t)}
          aria-label={`${t} theme`}
        />
      ))}
    </div>
  );
}
