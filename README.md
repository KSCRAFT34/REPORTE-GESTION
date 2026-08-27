# Trámites CRAFT — versión en línea (Render)

Esta es la versión con servidor de tu sistema de seguimiento de trámites: en vez de
guardar los datos solo en tu navegador, los guarda en una base de datos compartida,
así que todo tu equipo puede entrar a la misma URL, ver y actualizar la misma
información, y queda protegida con una contraseña.

## Qué incluye

- Una sola URL para todo el equipo, con distintos niveles de acceso que tú
  misma administras desde la pantalla de **Accesos** (ver abajo).
- Proyectos, trámites con costos de gestión/derechos, presupuesto y control de pagos.
- Pagos reales (estado de cuenta) separados de la proyección de costos.
- Subelementos dentro de un trámite (por ejemplo, los distintos pasos que exige una
  Licencia de Edificación), cada uno con su propia fecha y estatus.
- **Áreas** (comercial, obra, diseño, administración, due diligence,
  escrituración, otro): pantalla propia en el menú izquierdo donde capturas cada
  actividad igual que un trámite — con fecha de inicio y término, responsable, y su
  propio color por área — en vez de una fecha suelta. Se puede filtrar por área
  y por estado (Vigente, Por vencer, Urgente, Vencido, Completado), con
  botones "Todas"/"Ninguna" en cada filtro para no tener que ir marcando o
  desmarcando uno por uno.
- **Depende de**: tanto en trámites como en "Áreas" puedes marcar que una
  actividad depende de otra (de cualquiera de las dos secciones). Si después mueves
  la fecha de vencimiento de la actividad de la que depende (se atrasa o se
  adelanta), la actividad dependiente se recorre automáticamente el mismo número de
  días — y así en cadena con todo lo que dependa de esas. Ya no hay que ir moviendo
  fecha por fecha a mano cuando algo se atrasa.
- **Historial de fechas**: reporte aparte (menú izquierdo) que registra cada vez que
  se mueve la fecha de inicio o vencimiento de un trámite u otra área — a mano o por
  el recorrido automático explicado arriba. Muestra cuántas veces se ha movido cada
  actividad, su fecha original vs. la actual, y el detalle de cada cambio (fecha
  anterior → nueva, si fue manual o automático, y cuándo). La línea de tiempo
  principal siempre muestra solo la fecha vigente; este historial es para consultar
  aparte qué tanto se ha movido algo.
- **Líneas de tiempo**: pantalla propia en el menú izquierdo, separada del
  dashboard (con tanta información, mezclado con la tabla no se leía bien).
  Eliges un proyecto y ves su cronograma completo — trámites y áreas
  juntos, agrupados por tipo de actividad (Trámites, Comercial, Obra, Diseño,
  Administración, Due diligence, Escrituración, Otro) — con un botón por
  trámite/subelemento/actividad para decidir si aparece ahí. El dashboard conserva
  la tabla y los filtros de trámites; la parte visual de Gantt vive solo aquí.
  Tiene un selector de **Vista** (Mensual, Trimestral o Anual) para comprimir
  proyectos largos y que se puedan leer de un vistazo, y controles de **Zoom**
  (acercar, alejar, restablecer) para ajustar qué tan ancha se ve la línea de
  tiempo — útil cuando aun así se necesita ver el detalle día a día de un tramo.
- Pagos "de paquete" (ligados directo a un proyecto, sin trámite específico) y un
  campo libre de "Pagado a" (Gestor, Anticipo Gestor, Firma de DRO, o lo que escribas).
- Menú de **Catálogos** en la barra izquierda, con tres listas de apoyo que puedes ir
  llenando poco a poco (no piden todos los datos de una vez):
  - **Proyectos**: de una vez puedes anotar nombre y dirección.
  - **Actividad**: una lista maestra (nombre + dependencia + ciudad) para elegir de
    ahí al dar de alta un trámite real, en vez de escribirlo desde cero. En "Áreas",
    el campo "Nombre" de cada actividad nueva también se elige de esta lista (ya no
    se escribe libre) para que no queden dos veces la misma actividad con
    mayúscula/minúscula distinta — y si la que necesitas no está, hay un botón
    "+ Agregar actividad nueva al catálogo" ahí mismo en el formulario. Cada
    actividad del catálogo se puede editar (lápiz) o eliminar (bote de basura);
    ojo — si le cambias el nombre a una del catálogo, las actividades que ya
    capturaste con el nombre anterior NO cambian solas (quedan con el texto
    que tenían al momento de capturarlas).
  - **Proveedores**: tus gestores, DRO, etc., con nombre, tipo, ciudad, correo,
    teléfono y cuenta bancaria.
- Base de datos PostgreSQL (la crea Render automáticamente).
- Exportar/Importar en JSON como respaldo manual.

## Los niveles de acceso: edición, solo lectura y por área

La app pide una contraseña para entrar, y **según cuál escribas, entras con un
permiso distinto**. Todas comparten la misma URL — nadie necesita un usuario,
solo la contraseña que le corresponde.

Hay dos contraseñas "maestras", fijas, que se configuran una sola vez al
desplegar la app (Paso 2 más abajo):

- **Contraseña de edición** (`EDIT_PASSWORD`): puede capturar, editar y borrar
  todo (proyectos, trámites, pagos, subelementos, actividades de áreas,
  catálogos, proveedores), y además es la única que puede entrar a la pantalla
  de **Accesos** descrita abajo. Es la que usas tú.
- **Contraseña de solo lectura** (`VIEW_PASSWORD`): entra a la misma página, ve
  exactamente la misma información en tiempo real, pero no puede cambiar nada.
  Es tu contraseña de respaldo por si algo pasara con la pantalla de Accesos;
  para el uso normal del día a día, mejor crea accesos individuales (ver abajo).

### La pantalla de Accesos — tú creas y controlas las demás contraseñas

Ya no hace falta tocar nada en Render para dar de alta una contraseña nueva
para tu jefe, para Comercial, para Diseño, etc. Con la contraseña de edición,
en el menú izquierdo aparece **Accesos**: ahí puedes crear, editar, desactivar
o eliminar tú misma cuantas contraseñas necesites, cada una con el permiso que
le corresponda:

1. Entra con tu contraseña de edición y da clic en **Accesos** (menú
   izquierdo).
2. Da clic en el formulario de arriba: ponle un **nombre** al acceso (por
   ejemplo "Jefe", "Comercial", "Ana - Diseño" — el nombre que quieras, solo
   para identificarlo tú), elige el **permiso**:
   - **Solo lectura** — ve todo, no puede cambiar nada.
   - **Un área** — además de ver todo, puede capturar y editar (no eliminar)
     las actividades de esa área específica en "Áreas". Elige cuál área en el
     campo que aparece.
   - **Edición total** — mismo permiso que tu propia contraseña; úsalo con
     cuidado y solo para quien de verdad necesite editar todo.
3. Escribe una contraseña o da clic en **Generar** para que la app te
   proponga una segura y fácil de transcribir a mano. Cópiala y compártela
   con esa persona por el medio que prefieras (WhatsApp, correo, etc.) — la
   app no la vuelve a mostrar después, así que anótala antes de cerrar.
4. Da clic en **Crear acceso**. Ya está: esa persona puede entrar a la misma
   URL con esa contraseña y tiene el permiso que le diste.

Para **quitarle el acceso a alguien** no hace falta avisarle ni cambiarle
nada: en la tabla de la misma pantalla, da clic en el botón "Activo" de su
fila para desactivarlo (queda "Inactivo" — puedes reactivarlo después con el
mismo botón), o en el bote de basura para eliminarlo por completo. El efecto
es inmediato: si esa persona está usando la app en ese momento, en cuanto
vuelva a hacer clic en algo se le pedirá iniciar sesión de nuevo.

Con el lápiz puedes editar el nombre, el permiso, el área o la contraseña de
un acceso ya creado (deja el campo de contraseña en blanco si no quieres
cambiarla).

Así que para compartir con tu jefe o sus socios, les creas un acceso de solo
lectura: ven todo actualizado, sin riesgo de que muevan algo sin querer. Y
para que alguien de Comercial o Diseño mantenga sus propias fechas, le creas
un acceso de esa área.

## Antes de empezar: qué esperar del plan gratuito de Render

Para arrancar sin costo, ten en cuenta dos límites del plan gratuito de Render:

1. **El servicio web "se duerme"** si nadie lo usa por 15 minutos. La siguiente
   persona que entre esperará ~30-60 segundos mientras despierta. Después responde
   normal.
2. **La base de datos gratuita expira a los 30 días** de creada (y se borra 14 días
   después si no la subes de plan). Esto es un límite de Render, no de esta app.
   Para no perder tus trámites, tienes dos opciones (puedes hacer ambas):
   - Antes del día 30, sube la base de datos al plan pagado más económico
     (~$6 USD/mes) desde el panel de Render — tus datos se conservan sin límite.
   - Usa el botón **Exportar** de la app cada semana o dos para guardarte un
     respaldo en JSON por si acaso.

Si prefieres evitarte esto desde el inicio, puedes elegir el plan de pago
("Starter", desde ~$7 USD/mes por el servicio + ~$6 USD/mes por la base de datos)
al momento de desplegar, y saltarte el límite de los 30 días.

## Paso 1 — Subir este proyecto a un repositorio de GitHub

No necesitas usar la terminal ni git, y **todos los archivos van sueltos, sin
carpetas** (no hay que crear ninguna carpeta `views` ni `public`):

1. En GitHub, haz clic en el botón **+** (arriba a la derecha) → **New repository**.
2. Ponle un nombre, por ejemplo `tramites-craft`. Puede ser privado. Crea el
   repositorio (no marques ninguna opción de "agregar README").
3. En la página del repositorio recién creado, busca el enlace
   **"uploading an existing file"** (o ve a **Add file → Upload files**).
4. Descomprime el .zip en tu computadora y arrastra **todos los archivos que
   quedaron sueltos adentro** (`server.js`, `package.json`, `package-lock.json`,
   `render.yaml`, `README.md`, `index.html`, `login.html`, `styles.css`) tal
   cual, sin meterlos en ninguna carpeta. Confirma el commit.

## Paso 2 — Crear cuenta en Render y conectar el repositorio

1. Ve a https://render.com y crea una cuenta (puedes usar tu cuenta de GitHub
   para registrarte, así quedan conectadas automáticamente).
2. En el panel de Render, haz clic en **New +** → **Blueprint**.
3. Elige el repositorio `tramites-craft` que acabas de subir. Render leerá el
   archivo `render.yaml` incluido y va a proponer crear **dos cosas a la vez**:
   un servicio web y una base de datos PostgreSQL, ya conectados entre sí.
4. Cuando te lo pida, Render te va a pedir **dos valores**:
   - `EDIT_PASSWORD`: la contraseña de edición (para ti y quien capture información).
   - `VIEW_PASSWORD`: la contraseña de solo lectura (para compartir con tu jefe/socios).

   Escribe dos contraseñas distintas y guárdalas en un lugar seguro: la de
   edición es la que usarás tú para entrar y, desde ahí, crear el resto de los
   accesos (para tu jefe, para cada área, etc.) sin volver a tocar Render —
   ver la sección "Los niveles de acceso" más abajo.
5. Confirma con **Apply** / **Deploy**. La primera vez tarda unos minutos
   mientras instala todo, y la base de datos arranca ya con tus 6 proyectos y
   4 trámites reales cargados.

## Paso 3 — Usarla

1. Cuando termine el despliegue, Render te da una URL parecida a
   `https://tramites-craft.onrender.com`.
2. Comparte esa misma URL con tu equipo: a quien vaya a capturar información le
   das la contraseña de edición, y a quien solo necesite consultarla (tu jefe,
   sus socios) le das la contraseña de solo lectura.
3. La primera vez que alguien entra después de un rato de inactividad, la
   página puede tardar hasta un minuto en cargar (el servicio "despertando") —
   es normal en el plan gratuito.

## Actualizar la app más adelante

Aquí está la parte importante: **tu información (proyectos, trámites, pagos,
subelementos, hitos) vive en la base de datos, no en los archivos de código.**
Eso significa que cuando pidas un cambio nuevo (un campo, una función, un ajuste
de diseño), el flujo es:

1. Te preparo los archivos actualizados.
2. Los subes a tu repositorio de GitHub con **Add file → Upload files**
   (sobrescribe los que cambien).
3. Render detecta el cambio solo y vuelve a publicar la app en un par de minutos.

Todo lo que ya habías capturado sigue ahí exactamente igual — no hace falta que
exportes ni reenvíes nada por cada cambio. Eso solo era necesario con la versión
de archivo HTML; aquí ya no aplica. Aun así, sigue siendo buena idea usar
**Exportar** cada tanto para tener un respaldo propio en tu computadora.

## Estructura del proyecto

Todos los archivos van sueltos, sin carpetas:

```
server.js          Servidor Express: login, API de trámites, conexión a la base de datos
package.json        Dependencias (express, pg, cookie-parser)
package-lock.json
render.yaml          Define el servicio web + la base de datos para Render (Blueprint)
styles.css           Estilos compartidos (login y app)
login.html           Página de acceso con contraseña
index.html            La aplicación (línea de tiempo, tabla, formularios)
README.md
```
