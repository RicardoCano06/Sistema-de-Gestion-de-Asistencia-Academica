type LegalPageType = 'terminos' | 'privacidad' | 'soporte';

interface LegalInfoPageProps {
  page: LegalPageType;
  onBack: () => void;
}

const PAGE_META: Record<LegalPageType, { title: string; subtitle: string }> = {
  terminos: {
    title: 'Terminos y condiciones',
    subtitle: 'Marco de uso institucional del sistema desarrollado para fines academicos de tesis.',
  },
  privacidad: {
    title: 'Politica de privacidad',
    subtitle: 'Lineamientos para el tratamiento de datos en el contexto del proyecto academico.',
  },
  soporte: {
    title: 'Soporte',
    subtitle: 'Condiciones y alcance del soporte para la entrega de tesis y uso en facultad.',
  },
};

export function LegalInfoPage({ page, onBack }: LegalInfoPageProps) {
  const currentYear = new Date().getFullYear();
  const meta = PAGE_META[page];

  return (
    <div className="login-shell-bg min-h-screen w-full font-display text-[#e8eef8] max-lg:min-h-[100dvh] px-5 py-8 max-lg:px-3 max-lg:py-4 max-lg:pb-[max(1rem,env(safe-area-inset-bottom))] max-lg:pt-[max(1rem,env(safe-area-inset-top))] sm:px-8 lg:px-10">
      <div className="mx-auto w-full max-w-4xl rounded-2xl border border-white/15 bg-[#0d1f3d] p-6 shadow-[0_18px_45px_rgba(3,11,32,0.35)] max-lg:rounded-xl max-lg:p-4 max-lg:shadow-lg sm:p-8">
        <button
          type="button"
          onClick={onBack}
          className="mb-5 inline-flex items-center gap-2 rounded-lg border border-[#3d5270] bg-[#142744] px-3 py-2 text-sm font-medium text-white hover:border-[#5a7394] hover:bg-[#1a3154] max-lg:mb-4 max-lg:flex max-lg:w-full max-lg:justify-center max-lg:py-2.5"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          Volver a iniciar sesión
        </button>

        <header className="mb-7 border-b border-white/15 pb-5 max-lg:mb-5 max-lg:pb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#a8bdd4] max-lg:text-[10px]">
            Universidad Nihon Gakko
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-white max-lg:mt-1.5 max-lg:text-xl max-lg:leading-snug">
            {meta.title}
          </h1>
          <p className="mt-3 text-sm leading-snug text-[#d0ddf2] max-lg:mt-2 max-lg:text-xs max-lg:leading-relaxed">
            {meta.subtitle}
          </p>
        </header>

        {page === 'terminos' ? (
          <section className="space-y-5 text-sm leading-relaxed text-[#dce6f6] max-lg:space-y-4 max-lg:text-[13px] max-lg:leading-relaxed">
            <h2 className="text-lg font-semibold text-white max-lg:text-base">Clausulas generales</h2>
            <ol className="list-decimal space-y-3 pl-5 max-lg:space-y-2.5 max-lg:pl-4 max-lg:[&>li]:break-words">
              <li>
                Objeto y alcance funcional: el sistema se limita exclusivamente a la gestion y control de asistencias. Queda
                expresamente excluida la administracion de examenes, aulas, pagos, calificaciones, recursos humanos y cualquier
                otro modulo academico o administrativo no definido en esta tesis.
              </li>
              <li>
                Integraciones externas: no se contempla integracion con sistemas institucionales, academicos,
                administrativos o de recursos humanos. Toda integracion futura requerira solicitud formal y definicion de nuevo
                alcance tecnico y economico.
              </li>
              <li>
                Condicion de implementacion: el desarrollo corresponde a una entrega academica de tesis. No incluye,
                por defecto, mantenimiento correctivo, evolutivo, actualizaciones ni trabajos adicionales sin acuerdo expreso.
              </li>
              <li>
                Propiedad intelectual: el sistema, su documentacion y codigo fuente son propiedad exclusiva del autor.
                Se prohibe su reutilizacion, modificacion, distribucion, cesion o comercializacion sin consentimiento previo,
                expreso y por escrito.
              </li>
              <li>
                Formato documental: para la justificacion de inasistencias solo se acepta el formato PDF, con el fin de
                garantizar uniformidad documental, seguridad y facilidad de revision.
              </li>
            </ol>

            <p className="rounded-lg border border-[#2a3f5c] bg-[#050a14]/80 px-4 py-3 text-xs leading-relaxed text-[#dce6f6] max-lg:px-3 max-lg:py-2.5 max-lg:text-[11px]">
              La utilizacion del sistema por parte de usuarios autorizados implica aceptacion de las presentes condiciones en el
              marco del proyecto academico.
            </p>
          </section>
        ) : null}

        {page === 'privacidad' ? (
          <section className="space-y-5 text-sm leading-relaxed text-[#dce6f6] max-lg:space-y-4 max-lg:text-[13px] max-lg:leading-relaxed">
            <h2 className="text-lg font-semibold text-white max-lg:text-base">Principios de tratamiento de datos</h2>
            <ol className="list-decimal space-y-3 pl-5 max-lg:space-y-2.5 max-lg:pl-4 max-lg:[&>li]:break-words">
              <li>
                Finalidad: los datos gestionados en la plataforma se utilizan exclusivamente para registro, seguimiento y
                control de asistencias en la facultad.
              </li>
              <li>
                Minimacion: solo se procesan los datos estrictamente necesarios para el cumplimiento de la finalidad academica
                definida en el proyecto.
              </li>
              <li>
                Confidencialidad: el acceso a la informacion esta restringido por roles institucionales y credenciales de
                usuario.
              </li>
              <li>
                No cesion a terceros: no se contempla transferencia o comercializacion de datos personales a terceros externos
                al proyecto sin autorizacion formal.
              </li>
              <li>
                Evidencia documental: las justificaciones de inasistencia se admiten unicamente en formato PDF para preservar
                trazabilidad y control documental.
              </li>
            </ol>

            <p className="rounded-lg border border-[#2a3f5c] bg-[#050a14]/80 px-4 py-3 text-xs leading-relaxed text-[#dce6f6] max-lg:px-3 max-lg:py-2.5 max-lg:text-[11px]">
              La presente politica se aplica dentro del alcance academico del proyecto de tesis y no constituye un sistema de
              tratamiento de datos de alcance institucional integral.
            </p>
          </section>
        ) : null}

        {page === 'soporte' ? (
          <section className="space-y-5 text-sm leading-relaxed text-[#dce6f6] max-lg:space-y-4 max-lg:text-[13px] max-lg:leading-relaxed">
            <h2 className="text-lg font-semibold text-white max-lg:text-base">Condiciones de soporte</h2>
            <ol className="list-decimal space-y-3 pl-5 max-lg:space-y-2.5 max-lg:pl-4 max-lg:[&>li]:break-words">
              <li>
                El soporte se limita al periodo de desarrollo, validacion y sustentacion correspondiente al trabajo de tesis.
              </li>
              <li>
                Las atenciones se circunscriben al alcance funcional aprobado para control de asistencias.
              </li>
              <li>
                No se incluyen mejoras evolutivas, integraciones nuevas, migraciones, ni funcionalidades adicionales sin
                acuerdo previo.
              </li>
              <li>
                Toda solicitud extraordinaria debera gestionarse mediante coordinacion formal con el autor y la instancia
                academica correspondiente.
              </li>
            </ol>

            <p className="rounded-lg border border-[#2a3f5c] bg-[#050a14]/80 px-4 py-3 text-xs leading-relaxed text-[#dce6f6] max-lg:px-3 max-lg:py-2.5 max-lg:text-[11px]">
              Este apartado define soporte academico de proyecto y no representa un contrato de servicio permanente.
            </p>
          </section>
        ) : null}

        <footer className="mt-8 border-t border-white/15 pt-4 text-xs text-[#96abc4] max-lg:mt-6 max-lg:pt-3 max-lg:text-center max-lg:text-[10px] max-lg:leading-snug">
          <span className="max-lg:hidden">© {currentYear} Sistema de Gestión de Asistencia Académica - Proyecto de Tesis UNG.</span>
          <span className="hidden max-lg:inline">
            © {currentYear} Sistema de Gestion de Asistencia Academica
            <br />— Proyecto de Tesis UNG.
          </span>
        </footer>
      </div>
    </div>
  );
}
