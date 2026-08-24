# Trámites CRAFT — versión en línea (Render)

Esta es la versión con servidor de tu sistema de seguimiento de trámites: en vez de
guardar los datos solo en tu navegador, los guarda en una base de datos compartida,
así que todo tu equipo puede entrar a la misma URL, ver y actualizar la misma
información, y queda protegida con una contraseña.

## Qué incluye

- Una sola URL para todo el equipo, con dos niveles de acceso (ver abajo).
- Proyectos, trámites con costos de gestión/derechos, presupuesto y control de pagos.
- Pagos reales (estado de cuenta) separados de la proyección de costos.
- Subelementos dentro de un trámite (por ejemplo, los distintos pasos que exige una
  Licencia de Edificación), cada uno con su propia fecha y estatus.
- Hitos de otras áreas (comercial, obra, due diligence, etc.) que no son trámites
  pero que quieres ver junto con ellos en la línea de tiempo.
- Línea de tiempo (Gantt) con un botón por trámite/subelemento/hito para decidir si
  aparece ahí, más un filtro para mostrar solo trámites, solo otra área, o todo junto.
- Pagos "de paquete" (ligados directo a un proyecto, sin trámite específico) y un
  campo libre de "Pagado a" (Gestor, Anticipo Gestor, Firma de DRO, o lo que escribas).
- Menú de **Catálogos** en la barra izquierda, con tres listas de apoyo que puedes ir
  llenando poco a poco (no piden todos los datos de una vez):
  - **Proyectos**: de una vez puedes anotar nombre y dirección.
  - **Trámites**: una lista maestra (nombre + dependencia + ciudad) para elegir de
    ahí al dar de alta un trámite real, en vez de escribirlo desde cero.
  - **Proveedores**: tus gestores, DRO, etc., con nombre, tipo, ciudad, correo,
    teléfono y cuenta bancaria.
- Base de datos PostgreSQL (la crea Render automáticamente).
- Exportar/Importar en JSON como respaldo manual.

## Los dos niveles de acceso: edición y solo lectura

La app pide una contraseña para entrar, y **según cuál escribas, entras con un
permiso distinto**:

- **Contraseña de edición**: puede capturar, editar y borrar todo (proyectos,
  trámites, pagos, subelementos, hitos). Es la que usas tú y quien más necesite
  actualizar la información.
- **Contraseña de solo lectura**: entra a la misma página, ve exactamente la misma
  información en tiempo real, pero no puede cambiar nada — los botones de agregar,
  editar y borrar ni siquiera aparecen, y aunque alguien intentara forzarlo, el
  servidor rechaza cualquier cambio de todos modos.

Así que para compartir con tu jefe o sus socios, les das la URL y la contraseña de
solo lectura: ven todo actualizado, sin riesgo de que muevan algo sin querer.
Ambas contraseñas las defines tú al momento de desplegar (Paso 2).

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

   Escribe dos contraseñas distintas y guárdalas en un lugar seguro — son las que
   vas a compartir después, cada una con quien corresponda.
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
