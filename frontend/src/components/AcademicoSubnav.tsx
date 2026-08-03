import { NavLink } from 'react-router-dom';

export const ACADEMICO_TAB_BASE =
  'inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold dark:font-medium max-md:min-h-10 max-md:flex-1 max-md:px-2 max-md:py-2 max-md:text-center max-md:text-xs max-md:leading-snug max-md:whitespace-normal md:whitespace-nowrap ';
export const ACADEMICO_TAB_INACTIVE =
  'border-slate-300 text-slate-900 hover:text-black hover:border-slate-400 bg-white/60 dark:border-slate-700 dark:text-slate-300 dark:hover:text-white dark:hover:border-slate-500 dark:bg-slate-900/30';
export const ACADEMICO_TAB_ACTIVE =
  'border-primary/80 text-primary dark:text-[#e7eef9] bg-primary/10 dark:bg-primary/15';

export function AcademicoSubnav() {
  return (
    <nav
      className="grid w-full min-w-0 grid-cols-2 gap-2 pb-0.5 max-md:gap-1.5 md:flex md:max-w-full md:flex-nowrap md:items-center md:overflow-x-auto md:overflow-visible"
      aria-label="Secciones académicas"
    >
      <NavLink
        to="/app/academico"
        end
        className={({ isActive }) => `${ACADEMICO_TAB_BASE} ${isActive ? ACADEMICO_TAB_ACTIVE : ACADEMICO_TAB_INACTIVE}`}
      >
        <span className="material-symbols-outlined shrink-0 text-base max-md:hidden">auto_stories</span>
        Períodos y cursos
      </NavLink>
      <NavLink
        to="/app/academico/promocion"
        className={({ isActive }) => `${ACADEMICO_TAB_BASE} ${isActive ? ACADEMICO_TAB_ACTIVE : ACADEMICO_TAB_INACTIVE}`}
      >
        <span className="material-symbols-outlined shrink-0 text-base max-md:hidden">upgrade</span>
        <span className="max-md:hidden">Promoción de semestre</span>
        <span className="md:hidden">Promoción semestre</span>
      </NavLink>
    </nav>
  );
}
