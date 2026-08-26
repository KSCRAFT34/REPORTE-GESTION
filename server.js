"use strict";

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;
const EDIT_PASSWORD = process.env.EDIT_PASSWORD || "";
const VIEW_PASSWORD = process.env.VIEW_PASSWORD || "";
const COOKIE_SECRET = process.env.COOKIE_SECRET || "dev-secret-change-me";
const IS_PROD = process.env.NODE_ENV === "production";
const PAGO_TIPOS = ["gestion", "derechos"];
const ESTATUS_VALIDOS = ["no_iniciado", "en_proceso", "completado"];
const DURATION_UNITS = ["dias", "semanas", "meses"];
const HITO_AREAS = ["comercial", "obra", "diseno", "administracion", "due_diligence", "escrituracion", "otro"];

if (!EDIT_PASSWORD) {
  console.warn("AVISO: EDIT_PASSWORD no esta configurada. Nadie podra iniciar sesion con permiso de edicion.");
}
if (!VIEW_PASSWORD) {
  console.warn("AVISO: VIEW_PASSWORD no esta configurada. El acceso de solo lectura no funcionara hasta que la configures.");
}
if (!process.env.DATABASE_URL) {
  console.warn("AVISO: DATABASE_URL no esta configurada. La app no podra conectarse a la base de datos.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost")
    ? { rejectUnauthorized: false }
    : false
});

/* ================================================================
   Base de datos
   ================================================================ */
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS proyectos (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      ciudad TEXT,
      direccion TEXT DEFAULT '',
      notas TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // Migración: permitir registrar un proyecto solo con nombre (avanzar sin
  // tener toda la información) y guardar su dirección.
  await pool.query(`ALTER TABLE proyectos ALTER COLUMN ciudad DROP NOT NULL;`);
  await pool.query(`ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS direccion TEXT DEFAULT '';`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tramites (
      id TEXT PRIMARY KEY,
      proyecto_id TEXT NOT NULL REFERENCES proyectos(id) ON DELETE RESTRICT,
      nombre TEXT NOT NULL,
      presupuesto NUMERIC,
      costo_gestion NUMERIC NOT NULL DEFAULT 0,
      costo_derechos NUMERIC NOT NULL DEFAULT 0,
      estatus TEXT NOT NULL DEFAULT 'en_proceso',
      fecha_inicio DATE,
      fecha_vencimiento DATE,
      fecha_conclusion_real DATE,
      tiempo_valor NUMERIC,
      tiempo_unidad TEXT DEFAULT 'dias',
      responsable TEXT DEFAULT '',
      notas TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pagos (
      id TEXT PRIMARY KEY,
      tramite_id TEXT REFERENCES tramites(id) ON DELETE CASCADE,
      proyecto_id TEXT REFERENCES proyectos(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL,
      monto NUMERIC NOT NULL,
      fecha DATE,
      notas TEXT DEFAULT '',
      concepto TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE tramites ADD COLUMN IF NOT EXISTS incluir_linea_tiempo BOOLEAN NOT NULL DEFAULT true;`);
  // "Depende de": referencia genérica a otro trámite u hito ("t:<id>" o "h:<id>"),
  // para poder recorrer en cadena las fechas de los que dependen de él cuando se atrasa.
  await pool.query(`ALTER TABLE tramites ADD COLUMN IF NOT EXISTS depende_de TEXT;`);
  // Migración para bases de datos creadas antes de que los pagos pudieran
  // capturarse por proyecto (pago "de paquete") o llevar un concepto (Gestor/DRO/otro).
  await pool.query(`ALTER TABLE pagos ALTER COLUMN tramite_id DROP NOT NULL;`);
  await pool.query(`ALTER TABLE pagos ADD COLUMN IF NOT EXISTS proyecto_id TEXT REFERENCES proyectos(id) ON DELETE CASCADE;`);
  await pool.query(`ALTER TABLE pagos ADD COLUMN IF NOT EXISTS concepto TEXT DEFAULT '';`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subelementos (
      id TEXT PRIMARY KEY,
      tramite_id TEXT NOT NULL REFERENCES tramites(id) ON DELETE CASCADE,
      nombre TEXT NOT NULL,
      fecha DATE,
      estatus TEXT NOT NULL DEFAULT 'en_proceso',
      incluir_linea_tiempo BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hitos (
      id TEXT PRIMARY KEY,
      proyecto_id TEXT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
      nombre TEXT NOT NULL,
      area TEXT NOT NULL DEFAULT 'otro',
      fecha DATE,
      estatus TEXT NOT NULL DEFAULT 'en_proceso',
      incluir_linea_tiempo BOOLEAN NOT NULL DEFAULT true,
      notas TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // Migración: los hitos ahora se capturan con rango de fechas (inicio y
  // vencimiento, igual que un trámite) y un responsable, no solo una fecha suelta.
  // La columna "fecha" que ya existía se reutiliza como fecha de vencimiento.
  await pool.query(`ALTER TABLE hitos ADD COLUMN IF NOT EXISTS fecha_inicio DATE;`);
  await pool.query(`ALTER TABLE hitos ADD COLUMN IF NOT EXISTS responsable TEXT DEFAULT '';`);
  await pool.query(`ALTER TABLE hitos ADD COLUMN IF NOT EXISTS depende_de TEXT;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS catalogo_tramites (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      dependencia TEXT DEFAULT '',
      ciudad TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS proveedores (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      tipo TEXT DEFAULT '',
      ciudad TEXT DEFAULT '',
      correo TEXT DEFAULT '',
      telefono TEXT DEFAULT '',
      cuenta_bancaria TEXT DEFAULT '',
      notas TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Historial de cambios de fecha: cada vez que se mueve la fecha de inicio o
  // vencimiento de un trámite u hito (a mano, o automáticamente por cascada de
  // dependencias) se guarda un registro aquí. La línea de tiempo principal
  // siempre muestra solo la fecha vigente; este historial es un reporte aparte
  // para ver cuántas veces se ha movido una actividad y cuánto en total.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fecha_historial (
      id TEXT PRIMARY KEY,
      tipo TEXT NOT NULL,
      item_id TEXT NOT NULL,
      item_nombre TEXT DEFAULT '',
      proyecto_id TEXT,
      campo TEXT NOT NULL,
      fecha_anterior DATE,
      fecha_nueva DATE,
      motivo TEXT NOT NULL DEFAULT 'manual',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Si la base está totalmente vacía (primer arranque), la sembramos con los
  // datos reales de Karen para que la app no abra vacía ni con datos de ejemplo.
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM proyectos");
  if (rows[0].n === 0) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const proyectos = [
        { id: "id6d2798domt7kbtxt", nombre: "FLX La Cacho", ciudad: "Tijuana" },
        { id: "idqcwjt3m7mt7kc82h", nombre: "Insurgentes 320", ciudad: "CDMX" },
        { id: "idwdtldsaymt7kcf3i", nombre: "Vallarta", ciudad: "CDMX" },
        { id: "id00d6961hmt7kcmfq", nombre: "Juarez", ciudad: "Tijuana" },
        { id: "idrhqytps2mt7kcw1v", nombre: "Kavi", ciudad: "Guadalajara" },
        { id: "idmo5y1yrzmt7kd64n", nombre: "Zuno", ciudad: "Guadalajara" }
      ];
      for (const p of proyectos) {
        await client.query("INSERT INTO proyectos (id, nombre, ciudad, notas) VALUES ($1,$2,$3,'')", [p.id, p.nombre, p.ciudad]);
      }
      const tramites = [
        {
          id: "id7l8wyefrmt7kmnlg", proyectoId: "id6d2798domt7kbtxt", nombre: "Licencia de Uso de Suelo",
          fechaInicio: "2023-10-04", fechaVencimiento: "2023-10-04", fechaConclusionReal: "2023-10-04",
          estatus: "completado", responsable: "Daniel Rubio", notas: "El costo quedo dentro del costo del terreno"
        },
        {
          id: "idwuexl0b0mt7krx5a", proyectoId: "id6d2798domt7kbtxt", nombre: "Evaluacion del Estudio de Impacto Vial",
          fechaInicio: "2023-11-22", fechaVencimiento: "2023-11-22", fechaConclusionReal: "2023-11-22",
          estatus: "completado", responsable: "Daniel Rubio", notas: "el costo venia dentro del costo del terreno"
        },
        {
          id: "ida7ak8fdtmt7nzf91", proyectoId: "id6d2798domt7kbtxt", nombre: "Evaluación de impacto Urbano",
          fechaInicio: "2023-09-20", fechaVencimiento: "2023-09-20", fechaConclusionReal: "2023-09-20",
          estatus: "completado", responsable: "Daniel Rubio", notas: ""
        },
        {
          id: "idkqtntltpmt7o9buz", proyectoId: "id6d2798domt7kbtxt", nombre: "Alineamiento y numero oficial",
          fechaInicio: "2026-04-23", fechaVencimiento: "2026-04-23", fechaConclusionReal: "2026-04-23",
          estatus: "completado", responsable: "Daniel Rubio", notas: ""
        }
      ];
      for (const t of tramites) {
        await client.query(
          `INSERT INTO tramites (id, proyecto_id, nombre, presupuesto, costo_gestion, costo_derechos, estatus,
            fecha_inicio, fecha_vencimiento, fecha_conclusion_real, tiempo_valor, tiempo_unidad, responsable, notas, incluir_linea_tiempo)
           VALUES ($1,$2,$3,NULL,0,0,$4,$5,$6,$7,NULL,'dias',$8,$9,true)`,
          [t.id, t.proyectoId, t.nombre, t.estatus, t.fechaInicio, t.fechaVencimiento, t.fechaConclusionReal, t.responsable, t.notas]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("No se pudo sembrar la base con los datos iniciales:", err);
    } finally {
      client.release();
    }
  }
}

/* ================================================================
   Helpers de forma / validación
   ================================================================ */
function dateStr(v) { return v ? new Date(v).toISOString().slice(0, 10) : null; }

function proyectoRowToItem(row) {
  return { id: row.id, nombre: row.nombre, ciudad: row.ciudad || "", direccion: row.direccion || "", notas: row.notas || "" };
}
function catalogoTramiteRowToItem(row) {
  return { id: row.id, nombre: row.nombre, dependencia: row.dependencia || "", ciudad: row.ciudad || "" };
}
function historialFechaRowToItem(row) {
  return {
    id: row.id,
    tipo: row.tipo,
    itemId: row.item_id,
    itemNombre: row.item_nombre || "",
    proyectoId: row.proyecto_id || null,
    campo: row.campo,
    fechaAnterior: dateStr(row.fecha_anterior),
    fechaNueva: dateStr(row.fecha_nueva),
    motivo: row.motivo || "manual",
    fecha: row.created_at ? new Date(row.created_at).toISOString() : null
  };
}
function proveedorRowToItem(row) {
  return {
    id: row.id, nombre: row.nombre, tipo: row.tipo || "", ciudad: row.ciudad || "",
    correo: row.correo || "", telefono: row.telefono || "", cuentaBancaria: row.cuenta_bancaria || "",
    notas: row.notas || ""
  };
}
function tramiteRowToItem(row) {
  return {
    id: row.id,
    proyectoId: row.proyecto_id,
    nombre: row.nombre,
    presupuesto: row.presupuesto != null ? Number(row.presupuesto) : null,
    costoGestion: Number(row.costo_gestion) || 0,
    costoDerechos: Number(row.costo_derechos) || 0,
    estatus: row.estatus,
    fechaInicio: dateStr(row.fecha_inicio) || "",
    fechaVencimiento: dateStr(row.fecha_vencimiento) || "",
    fechaConclusionReal: dateStr(row.fecha_conclusion_real) || "",
    tiempoValor: row.tiempo_valor != null ? Number(row.tiempo_valor) : null,
    tiempoUnidad: row.tiempo_unidad || "dias",
    responsable: row.responsable || "",
    notas: row.notas || "",
    incluirLineaTiempo: row.incluir_linea_tiempo !== false,
    dependeDe: row.depende_de || null
  };
}
function pagoRowToItem(row) {
  return {
    id: row.id, tramiteId: row.tramite_id || null, proyectoId: row.proyecto_id || null, tipo: row.tipo,
    monto: Number(row.monto) || 0, fecha: dateStr(row.fecha) || "", notas: row.notas || "",
    concepto: row.concepto || ""
  };
}
function subelementoRowToItem(row) {
  return {
    id: row.id, tramiteId: row.tramite_id, nombre: row.nombre,
    fecha: dateStr(row.fecha) || "", estatus: row.estatus,
    incluirLineaTiempo: row.incluir_linea_tiempo !== false
  };
}
function hitoRowToItem(row) {
  return {
    id: row.id, proyectoId: row.proyecto_id, nombre: row.nombre, area: row.area,
    fechaInicio: dateStr(row.fecha_inicio) || "",
    fechaVencimiento: dateStr(row.fecha) || "",
    estatus: row.estatus, responsable: row.responsable || "", notas: row.notas || "",
    incluirLineaTiempo: row.incluir_linea_tiempo !== false,
    dependeDe: row.depende_de || null
  };
}

function sanitizeProyecto(body) {
  const nombre = String((body && body.nombre) || "").trim();
  if (!nombre) return null;
  const ciudad = String((body && body.ciudad) || "").trim();
  const direccion = String((body && body.direccion) || "").trim();
  return { nombre, ciudad, direccion, notas: String((body && body.notas) || "").trim() };
}

function sanitizeCatalogoTramite(body) {
  const nombre = String((body && body.nombre) || "").trim();
  if (!nombre) return null;
  return {
    nombre,
    dependencia: String((body && body.dependencia) || "").trim(),
    ciudad: String((body && body.ciudad) || "").trim()
  };
}

function sanitizeProveedor(body) {
  const nombre = String((body && body.nombre) || "").trim();
  if (!nombre) return null;
  return {
    nombre,
    tipo: String((body && body.tipo) || "").trim(),
    ciudad: String((body && body.ciudad) || "").trim(),
    correo: String((body && body.correo) || "").trim(),
    telefono: String((body && body.telefono) || "").trim(),
    cuentaBancaria: String((body && body.cuentaBancaria) || "").trim(),
    notas: String((body && body.notas) || "").trim()
  };
}

// Valida una referencia "depende de" con forma "t:<id>" o "h:<id>" (trámite o hito).
// selfRef (p. ej. "t:<esteId>") se rechaza para no permitir que algo dependa de sí mismo.
function sanitizeDependeDe(value, selfRef) {
  const v = String(value || "").trim();
  if (!v) return null;
  if (!/^[th]:.+/.test(v)) return null;
  if (selfRef && v === selfRef) return null;
  return v;
}

function sanitizeTramite(body, selfId) {
  const nombre = String((body && body.nombre) || "").trim();
  const proyectoId = String((body && body.proyectoId) || "").trim();
  const fechaVencimiento = body && body.fechaVencimiento ? String(body.fechaVencimiento).slice(0, 10) : null;
  if (!nombre || !proyectoId || !fechaVencimiento) return null;
  const estatus = ESTATUS_VALIDOS.includes(body.estatus) ? body.estatus : "en_proceso";
  const presupuestoRaw = body.presupuesto;
  const presupuesto = (presupuestoRaw !== undefined && presupuestoRaw !== null && presupuestoRaw !== "") ? Number(presupuestoRaw) : null;
  return {
    nombre, proyectoId,
    presupuesto: isFinite(presupuesto) ? presupuesto : null,
    costoGestion: Number(body.costoGestion) || 0,
    costoDerechos: Number(body.costoDerechos) || 0,
    estatus,
    fechaInicio: body.fechaInicio ? String(body.fechaInicio).slice(0, 10) : null,
    fechaVencimiento,
    fechaConclusionReal: body.fechaConclusionReal ? String(body.fechaConclusionReal).slice(0, 10) : null,
    tiempoValor: body.tiempoValor ? Number(body.tiempoValor) : null,
    tiempoUnidad: DURATION_UNITS.includes(body.tiempoUnidad) ? body.tiempoUnidad : "dias",
    responsable: String(body.responsable || "").trim(),
    notas: String(body.notas || "").trim(),
    incluirLineaTiempo: body.incluirLineaTiempo === false ? false : true,
    dependeDe: sanitizeDependeDe(body.dependeDe, selfId ? "t:" + selfId : null)
  };
}

function sanitizePago(body) {
  const tramiteId = String((body && body.tramiteId) || "").trim() || null;
  const proyectoId = String((body && body.proyectoId) || "").trim() || null;
  if (!tramiteId && !proyectoId) return null;
  const tipo = PAGO_TIPOS.includes(body && body.tipo) ? body.tipo : null;
  const monto = Number(body && body.monto);
  const fecha = body && body.fecha ? String(body.fecha).slice(0, 10) : null;
  if (!tipo || !isFinite(monto) || monto <= 0 || !fecha) return null;
  return {
    // Un pago va ligado a un trámite específico, O a todo el proyecto (pago de
    // paquete) — si viene un trámite, ese manda y no guardamos el proyecto.
    tramiteId: tramiteId || null,
    proyectoId: tramiteId ? null : proyectoId,
    tipo, monto, fecha,
    notas: String((body && body.notas) || "").trim(),
    concepto: String((body && body.concepto) || "").trim()
  };
}

function sanitizeSubelemento(body) {
  const tramiteId = String((body && body.tramiteId) || "").trim();
  const nombre = String((body && body.nombre) || "").trim();
  if (!tramiteId || !nombre) return null;
  const estatus = ESTATUS_VALIDOS.includes(body.estatus) ? body.estatus : "en_proceso";
  return {
    tramiteId, nombre,
    fecha: body.fecha ? String(body.fecha).slice(0, 10) : null,
    estatus,
    incluirLineaTiempo: body.incluirLineaTiempo === false ? false : true
  };
}

function sanitizeHito(body, selfId) {
  const proyectoId = String((body && body.proyectoId) || "").trim();
  const nombre = String((body && body.nombre) || "").trim();
  const fechaVencimiento = body && body.fechaVencimiento ? String(body.fechaVencimiento).slice(0, 10) : null;
  if (!proyectoId || !nombre || !fechaVencimiento) return null;
  const area = HITO_AREAS.includes(body.area) ? body.area : "otro";
  const estatus = ESTATUS_VALIDOS.includes(body.estatus) ? body.estatus : "en_proceso";
  return {
    proyectoId, nombre, area,
    fechaInicio: body.fechaInicio ? String(body.fechaInicio).slice(0, 10) : null,
    fechaVencimiento,
    estatus,
    responsable: String((body && body.responsable) || "").trim(),
    notas: String((body && body.notas) || "").trim(),
    incluirLineaTiempo: body.incluirLineaTiempo === false ? false : true,
    dependeDe: sanitizeDependeDe(body.dependeDe, selfId ? "h:" + selfId : null)
  };
}

/* ================================================================
   Historial de cambios de fecha: cada movimiento (manual o por cascada)
   de la fecha de inicio o vencimiento de un trámite/hito se registra
   aquí, para el reporte aparte de "Historial de fechas".
   ================================================================ */
function shiftDateStr(v, deltaDays) {
  if (!v) return null;
  const base = new Date(v);
  if (isNaN(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return dateStr(base);
}

async function logFechaChange(client, { tipo, itemId, itemNombre, proyectoId, campo, fechaAnterior, fechaNueva, motivo }) {
  const before = dateStr(fechaAnterior);
  const after = dateStr(fechaNueva);
  if (before === after) return; // sin cambio real, no se registra
  await client.query(
    `INSERT INTO fecha_historial (id, tipo, item_id, item_nombre, proyecto_id, campo, fecha_anterior, fecha_nueva, motivo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [crypto.randomUUID(), tipo, itemId, itemNombre || "", proyectoId || null, campo, before, after, motivo || "manual"]
  );
}

/* ================================================================
   Cadena de dependencias: si la fecha de vencimiento de un trámite u
   hito se recorre, todo lo que "depende de" él se recorre lo mismo
   (y así en cadena con lo que depende de esos, evitando ciclos).
   Cada recorrido automático también queda anotado en el historial.
   ================================================================ */
async function cascadeShift(client, originRef, deltaDays, visited) {
  const result = { tramites: 0, hitos: 0 };
  if (!deltaDays) return result;
  visited = visited || new Set();
  if (visited.has(originRef)) return result;
  visited.add(originRef);

  const tRows = await client.query(
    "SELECT id, nombre, proyecto_id, fecha_inicio, fecha_vencimiento FROM tramites WHERE depende_de = $1",
    [originRef]
  );
  for (const row of tRows.rows) {
    const ref = "t:" + row.id;
    if (visited.has(ref)) continue;
    const nuevoInicio = shiftDateStr(row.fecha_inicio, deltaDays);
    const nuevoVencimiento = shiftDateStr(row.fecha_vencimiento, deltaDays);
    await client.query(
      `UPDATE tramites SET fecha_inicio = $1, fecha_vencimiento = $2, updated_at = now() WHERE id = $3`,
      [nuevoInicio, nuevoVencimiento, row.id]
    );
    await logFechaChange(client, { tipo: "tramite", itemId: row.id, itemNombre: row.nombre, proyectoId: row.proyecto_id, campo: "inicio", fechaAnterior: row.fecha_inicio, fechaNueva: nuevoInicio, motivo: "cascada" });
    await logFechaChange(client, { tipo: "tramite", itemId: row.id, itemNombre: row.nombre, proyectoId: row.proyecto_id, campo: "vencimiento", fechaAnterior: row.fecha_vencimiento, fechaNueva: nuevoVencimiento, motivo: "cascada" });
    result.tramites++;
    const sub = await cascadeShift(client, ref, deltaDays, visited);
    result.tramites += sub.tramites; result.hitos += sub.hitos;
  }

  const hRows = await client.query(
    "SELECT id, nombre, proyecto_id, fecha_inicio, fecha FROM hitos WHERE depende_de = $1",
    [originRef]
  );
  for (const row of hRows.rows) {
    const ref = "h:" + row.id;
    if (visited.has(ref)) continue;
    const nuevoInicio = shiftDateStr(row.fecha_inicio, deltaDays);
    const nuevoVencimiento = shiftDateStr(row.fecha, deltaDays);
    await client.query(
      `UPDATE hitos SET fecha_inicio = $1, fecha = $2, updated_at = now() WHERE id = $3`,
      [nuevoInicio, nuevoVencimiento, row.id]
    );
    await logFechaChange(client, { tipo: "hito", itemId: row.id, itemNombre: row.nombre, proyectoId: row.proyecto_id, campo: "inicio", fechaAnterior: row.fecha_inicio, fechaNueva: nuevoInicio, motivo: "cascada" });
    await logFechaChange(client, { tipo: "hito", itemId: row.id, itemNombre: row.nombre, proyectoId: row.proyecto_id, campo: "vencimiento", fechaAnterior: row.fecha, fechaNueva: nuevoVencimiento, motivo: "cascada" });
    result.hitos++;
    const sub = await cascadeShift(client, ref, deltaDays, visited);
    result.tramites += sub.tramites; result.hitos += sub.hitos;
  }

  return result;
}

/* ================================================================
   App / autenticación
   ================================================================ */
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser(COOKIE_SECRET));
// Servimos solo el CSS de forma pública (no toda la carpeta del proyecto,
// para no exponer server.js ni otros archivos internos).
app.get("/styles.css", (req, res) => res.sendFile(path.join(__dirname, "styles.css")));

function getRole(req) {
  const role = req.signedCookies && req.signedCookies.role;
  return role === "editor" || role === "viewer" ? role : null;
}
function requireAuth(req, res, next) {
  if (getRole(req)) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "No autorizado" });
  return res.redirect("/login");
}
function requireEditor(req, res, next) {
  const role = getRole(req);
  if (role === "editor") return next();
  if (role === "viewer") return res.status(403).json({ error: "Estás en modo de solo lectura; no puedes hacer cambios." });
  return res.status(401).json({ error: "No autorizado" });
}

/* ---------------- Auth routes ---------------- */
app.get("/login", (req, res) => {
  if (getRole(req)) return res.redirect("/");
  res.sendFile(path.join(__dirname, "login.html"));
});

app.post("/api/login", (req, res) => {
  const password = String((req.body && req.body.password) || "");
  let role = null;
  if (EDIT_PASSWORD && password === EDIT_PASSWORD) role = "editor";
  else if (VIEW_PASSWORD && password === VIEW_PASSWORD) role = "viewer";
  if (!role) return res.status(401).json({ ok: false, error: "Contraseña incorrecta." });
  res.cookie("role", role, {
    signed: true, httpOnly: true, sameSite: "lax", secure: IS_PROD,
    maxAge: 1000 * 60 * 60 * 24 * 30
  });
  return res.json({ ok: true, role });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("role");
  res.json({ ok: true });
});

app.get("/api/session", requireAuth, (req, res) => {
  res.json({ role: getRole(req) });
});

/* ---------------- App protegida ---------------- */
app.get("/", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/* ---------------- Lectura de todo el dataset ---------------- */
app.get("/api/data", requireAuth, async (req, res) => {
  try {
    const [proyectos, tramites, pagos, subelementos, hitos, catalogoTramites, proveedores, historialFechas] = await Promise.all([
      pool.query("SELECT * FROM proyectos ORDER BY nombre ASC"),
      pool.query("SELECT * FROM tramites ORDER BY fecha_vencimiento ASC NULLS LAST"),
      pool.query("SELECT * FROM pagos ORDER BY fecha DESC NULLS LAST"),
      pool.query("SELECT * FROM subelementos ORDER BY fecha ASC NULLS LAST"),
      pool.query("SELECT * FROM hitos ORDER BY fecha ASC NULLS LAST"),
      pool.query("SELECT * FROM catalogo_tramites ORDER BY nombre ASC"),
      pool.query("SELECT * FROM proveedores ORDER BY nombre ASC"),
      pool.query("SELECT * FROM fecha_historial ORDER BY created_at DESC LIMIT 3000")
    ]);
    res.json({
      proyectos: proyectos.rows.map(proyectoRowToItem),
      tramites: tramites.rows.map(tramiteRowToItem),
      pagos: pagos.rows.map(pagoRowToItem),
      subelementos: subelementos.rows.map(subelementoRowToItem),
      hitos: hitos.rows.map(hitoRowToItem),
      catalogoTramites: catalogoTramites.rows.map(catalogoTramiteRowToItem),
      proveedores: proveedores.rows.map(proveedorRowToItem),
      historialFechas: historialFechas.rows.map(historialFechaRowToItem)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo leer la base de datos." });
  }
});

/* ---------------- Proyectos ---------------- */
app.post("/api/proyectos", requireEditor, async (req, res) => {
  const data = sanitizeProyecto(req.body);
  if (!data) return res.status(400).json({ error: "Completa al menos el nombre del proyecto." });
  const id = crypto.randomUUID();
  try {
    const result = await pool.query(
      "INSERT INTO proyectos (id, nombre, ciudad, direccion, notas) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [id, data.nombre, data.ciudad, data.direccion, data.notas]
    );
    res.status(201).json(proyectoRowToItem(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo guardar el proyecto." });
  }
});

app.put("/api/proyectos/:id", requireEditor, async (req, res) => {
  const data = sanitizeProyecto(req.body);
  if (!data) return res.status(400).json({ error: "Completa al menos el nombre del proyecto." });
  try {
    const result = await pool.query(
      "UPDATE proyectos SET nombre=$1, ciudad=$2, direccion=$3, notas=$4, updated_at=now() WHERE id=$5 RETURNING *",
      [data.nombre, data.ciudad, data.direccion, data.notas, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Proyecto no encontrado." });
    res.json(proyectoRowToItem(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo actualizar el proyecto." });
  }
});

app.delete("/api/proyectos/:id", requireEditor, async (req, res) => {
  try {
    const linked = await pool.query("SELECT COUNT(*)::int AS n FROM tramites WHERE proyecto_id=$1", [req.params.id]);
    if (linked.rows[0].n > 0) {
      return res.status(409).json({ error: "No se puede eliminar: tiene " + linked.rows[0].n + " trámite(s) asociado(s)." });
    }
    await pool.query("DELETE FROM proyectos WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo eliminar el proyecto." });
  }
});

/* ---------------- Trámites ---------------- */
app.post("/api/tramites", requireEditor, async (req, res) => {
  const data = sanitizeTramite(req.body || {});
  if (!data) return res.status(400).json({ error: "Faltan campos obligatorios (trámite, proyecto, vencimiento)." });
  const id = crypto.randomUUID();
  try {
    const result = await pool.query(
      `INSERT INTO tramites (id, proyecto_id, nombre, presupuesto, costo_gestion, costo_derechos, estatus,
        fecha_inicio, fecha_vencimiento, fecha_conclusion_real, tiempo_valor, tiempo_unidad, responsable, notas, incluir_linea_tiempo, depende_de)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [id, data.proyectoId, data.nombre, data.presupuesto, data.costoGestion, data.costoDerechos, data.estatus,
        data.fechaInicio, data.fechaVencimiento, data.fechaConclusionReal, data.tiempoValor, data.tiempoUnidad,
        data.responsable, data.notas, data.incluirLineaTiempo, data.dependeDe]
    );
    res.status(201).json(tramiteRowToItem(result.rows[0]));
  } catch (err) {
    console.error(err);
    if (err.code === "23503") return res.status(400).json({ error: "El proyecto seleccionado no existe." });
    res.status(500).json({ error: "No se pudo guardar el trámite." });
  }
});

app.put("/api/tramites/:id", requireEditor, async (req, res) => {
  const data = sanitizeTramite(req.body || {}, req.params.id);
  if (!data) return res.status(400).json({ error: "Faltan campos obligatorios (trámite, proyecto, vencimiento)." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const prevRes = await client.query("SELECT fecha_inicio, fecha_vencimiento FROM tramites WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!prevRes.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Trámite no encontrado." }); }
    const prevInicio = dateStr(prevRes.rows[0].fecha_inicio);
    const prevFecha = dateStr(prevRes.rows[0].fecha_vencimiento);

    const result = await client.query(
      `UPDATE tramites SET proyecto_id=$1, nombre=$2, presupuesto=$3, costo_gestion=$4, costo_derechos=$5,
        estatus=$6, fecha_inicio=$7, fecha_vencimiento=$8, fecha_conclusion_real=$9, tiempo_valor=$10,
        tiempo_unidad=$11, responsable=$12, notas=$13, incluir_linea_tiempo=$14, depende_de=$15, updated_at=now() WHERE id=$16 RETURNING *`,
      [data.proyectoId, data.nombre, data.presupuesto, data.costoGestion, data.costoDerechos, data.estatus,
        data.fechaInicio, data.fechaVencimiento, data.fechaConclusionReal, data.tiempoValor, data.tiempoUnidad,
        data.responsable, data.notas, data.incluirLineaTiempo, data.dependeDe, req.params.id]
    );

    await logFechaChange(client, { tipo: "tramite", itemId: req.params.id, itemNombre: data.nombre, proyectoId: data.proyectoId, campo: "inicio", fechaAnterior: prevInicio, fechaNueva: data.fechaInicio, motivo: "manual" });
    await logFechaChange(client, { tipo: "tramite", itemId: req.params.id, itemNombre: data.nombre, proyectoId: data.proyectoId, campo: "vencimiento", fechaAnterior: prevFecha, fechaNueva: data.fechaVencimiento, motivo: "manual" });

    let cascaded = { tramites: 0, hitos: 0 };
    if (prevFecha && data.fechaVencimiento) {
      const deltaDays = Math.round((new Date(data.fechaVencimiento) - new Date(prevFecha)) / 86400000);
      if (deltaDays) cascaded = await cascadeShift(client, "t:" + req.params.id, deltaDays);
    }

    await client.query("COMMIT");
    res.json(Object.assign(tramiteRowToItem(result.rows[0]), { cascaded }));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    if (err.code === "23503") return res.status(400).json({ error: "El proyecto seleccionado no existe." });
    res.status(500).json({ error: "No se pudo actualizar el trámite." });
  } finally {
    client.release();
  }
});

app.delete("/api/tramites/:id", requireEditor, async (req, res) => {
  try {
    await pool.query("DELETE FROM tramites WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo eliminar el trámite." });
  }
});

/* ---------------- Pagos ---------------- */
app.post("/api/pagos", requireEditor, async (req, res) => {
  const data = sanitizePago(req.body || {});
  if (!data) return res.status(400).json({ error: "Completa proyecto (o trámite), tipo, monto y fecha." });
  const id = crypto.randomUUID();
  try {
    const result = await pool.query(
      "INSERT INTO pagos (id, tramite_id, proyecto_id, tipo, monto, fecha, notas, concepto) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [id, data.tramiteId, data.proyectoId, data.tipo, data.monto, data.fecha, data.notas, data.concepto]
    );
    res.status(201).json(pagoRowToItem(result.rows[0]));
  } catch (err) {
    console.error(err);
    if (err.code === "23503") return res.status(400).json({ error: "El trámite o proyecto seleccionado no existe." });
    res.status(500).json({ error: "No se pudo registrar el pago." });
  }
});

app.delete("/api/pagos/:id", requireEditor, async (req, res) => {
  try {
    await pool.query("DELETE FROM pagos WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo eliminar el pago." });
  }
});

/* ---------------- Subelementos ---------------- */
app.post("/api/subelementos", requireEditor, async (req, res) => {
  const data = sanitizeSubelemento(req.body || {});
  if (!data) return res.status(400).json({ error: "Completa el trámite y el nombre del subelemento." });
  const id = crypto.randomUUID();
  try {
    const result = await pool.query(
      "INSERT INTO subelementos (id, tramite_id, nombre, fecha, estatus, incluir_linea_tiempo) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [id, data.tramiteId, data.nombre, data.fecha, data.estatus, data.incluirLineaTiempo]
    );
    res.status(201).json(subelementoRowToItem(result.rows[0]));
  } catch (err) {
    console.error(err);
    if (err.code === "23503") return res.status(400).json({ error: "El trámite seleccionado no existe." });
    res.status(500).json({ error: "No se pudo guardar el subelemento." });
  }
});

app.put("/api/subelementos/:id", requireEditor, async (req, res) => {
  const data = sanitizeSubelemento(req.body || {});
  if (!data) return res.status(400).json({ error: "Completa el trámite y el nombre del subelemento." });
  try {
    const result = await pool.query(
      `UPDATE subelementos SET tramite_id=$1, nombre=$2, fecha=$3, estatus=$4, incluir_linea_tiempo=$5, updated_at=now()
       WHERE id=$6 RETURNING *`,
      [data.tramiteId, data.nombre, data.fecha, data.estatus, data.incluirLineaTiempo, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Subelemento no encontrado." });
    res.json(subelementoRowToItem(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo actualizar el subelemento." });
  }
});

app.delete("/api/subelementos/:id", requireEditor, async (req, res) => {
  try {
    await pool.query("DELETE FROM subelementos WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo eliminar el subelemento." });
  }
});

/* ---------------- Hitos (otras áreas: comercial, obra, due diligence, etc.) ---------------- */
app.post("/api/hitos", requireEditor, async (req, res) => {
  const data = sanitizeHito(req.body || {});
  if (!data) return res.status(400).json({ error: "Completa el proyecto, el nombre y la fecha de término de la actividad." });
  const id = crypto.randomUUID();
  try {
    const result = await pool.query(
      `INSERT INTO hitos (id, proyecto_id, nombre, area, fecha_inicio, fecha, estatus, responsable, notas, incluir_linea_tiempo, depende_de)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [id, data.proyectoId, data.nombre, data.area, data.fechaInicio, data.fechaVencimiento, data.estatus, data.responsable, data.notas, data.incluirLineaTiempo, data.dependeDe]
    );
    res.status(201).json(hitoRowToItem(result.rows[0]));
  } catch (err) {
    console.error(err);
    if (err.code === "23503") return res.status(400).json({ error: "El proyecto seleccionado no existe." });
    res.status(500).json({ error: "No se pudo guardar la actividad." });
  }
});

app.put("/api/hitos/:id", requireEditor, async (req, res) => {
  const data = sanitizeHito(req.body || {}, req.params.id);
  if (!data) return res.status(400).json({ error: "Completa el proyecto, el nombre y la fecha de término de la actividad." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const prevRes = await client.query("SELECT fecha_inicio, fecha FROM hitos WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!prevRes.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Actividad no encontrada." }); }
    const prevInicio = dateStr(prevRes.rows[0].fecha_inicio);
    const prevFecha = dateStr(prevRes.rows[0].fecha);

    const result = await client.query(
      `UPDATE hitos SET proyecto_id=$1, nombre=$2, area=$3, fecha_inicio=$4, fecha=$5, estatus=$6, responsable=$7, notas=$8, incluir_linea_tiempo=$9, depende_de=$10, updated_at=now()
       WHERE id=$11 RETURNING *`,
      [data.proyectoId, data.nombre, data.area, data.fechaInicio, data.fechaVencimiento, data.estatus, data.responsable, data.notas, data.incluirLineaTiempo, data.dependeDe, req.params.id]
    );

    await logFechaChange(client, { tipo: "hito", itemId: req.params.id, itemNombre: data.nombre, proyectoId: data.proyectoId, campo: "inicio", fechaAnterior: prevInicio, fechaNueva: data.fechaInicio, motivo: "manual" });
    await logFechaChange(client, { tipo: "hito", itemId: req.params.id, itemNombre: data.nombre, proyectoId: data.proyectoId, campo: "vencimiento", fechaAnterior: prevFecha, fechaNueva: data.fechaVencimiento, motivo: "manual" });

    let cascaded = { tramites: 0, hitos: 0 };
    if (prevFecha && data.fechaVencimiento) {
      const deltaDays = Math.round((new Date(data.fechaVencimiento) - new Date(prevFecha)) / 86400000);
      if (deltaDays) cascaded = await cascadeShift(client, "h:" + req.params.id, deltaDays);
    }

    await client.query("COMMIT");
    res.json(Object.assign(hitoRowToItem(result.rows[0]), { cascaded }));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "No se pudo actualizar la actividad." });
  } finally {
    client.release();
  }
});

app.delete("/api/hitos/:id", requireEditor, async (req, res) => {
  try {
    await pool.query("DELETE FROM hitos WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo eliminar la actividad." });
  }
});

/* ---------------- Catálogo de trámites (lista maestra, sin fechas ni costos) ---------------- */
app.post("/api/catalogo-tramites", requireEditor, async (req, res) => {
  const data = sanitizeCatalogoTramite(req.body || {});
  if (!data) return res.status(400).json({ error: "Completa al menos el nombre de la actividad." });
  const id = crypto.randomUUID();
  try {
    const result = await pool.query(
      "INSERT INTO catalogo_tramites (id, nombre, dependencia, ciudad) VALUES ($1,$2,$3,$4) RETURNING *",
      [id, data.nombre, data.dependencia, data.ciudad]
    );
    res.status(201).json(catalogoTramiteRowToItem(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo guardar la actividad en el catálogo." });
  }
});

app.put("/api/catalogo-tramites/:id", requireEditor, async (req, res) => {
  const data = sanitizeCatalogoTramite(req.body || {});
  if (!data) return res.status(400).json({ error: "Completa al menos el nombre de la actividad." });
  try {
    const result = await pool.query(
      "UPDATE catalogo_tramites SET nombre=$1, dependencia=$2, ciudad=$3, updated_at=now() WHERE id=$4 RETURNING *",
      [data.nombre, data.dependencia, data.ciudad, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "No encontrado." });
    res.json(catalogoTramiteRowToItem(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo actualizar." });
  }
});

app.delete("/api/catalogo-tramites/:id", requireEditor, async (req, res) => {
  try {
    await pool.query("DELETE FROM catalogo_tramites WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo eliminar." });
  }
});

/* ---------------- Proveedores (gestores, DRO, etc.) ---------------- */
app.post("/api/proveedores", requireEditor, async (req, res) => {
  const data = sanitizeProveedor(req.body || {});
  if (!data) return res.status(400).json({ error: "Completa al menos el nombre del proveedor." });
  const id = crypto.randomUUID();
  try {
    const result = await pool.query(
      `INSERT INTO proveedores (id, nombre, tipo, ciudad, correo, telefono, cuenta_bancaria, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [id, data.nombre, data.tipo, data.ciudad, data.correo, data.telefono, data.cuentaBancaria, data.notas]
    );
    res.status(201).json(proveedorRowToItem(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo guardar el proveedor." });
  }
});

app.put("/api/proveedores/:id", requireEditor, async (req, res) => {
  const data = sanitizeProveedor(req.body || {});
  if (!data) return res.status(400).json({ error: "Completa al menos el nombre del proveedor." });
  try {
    const result = await pool.query(
      `UPDATE proveedores SET nombre=$1, tipo=$2, ciudad=$3, correo=$4, telefono=$5, cuenta_bancaria=$6, notas=$7, updated_at=now()
       WHERE id=$8 RETURNING *`,
      [data.nombre, data.tipo, data.ciudad, data.correo, data.telefono, data.cuentaBancaria, data.notas, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "No encontrado." });
    res.json(proveedorRowToItem(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo actualizar." });
  }
});

app.delete("/api/proveedores/:id", requireEditor, async (req, res) => {
  try {
    await pool.query("DELETE FROM proveedores WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo eliminar." });
  }
});

/* ---------------- Importar (respaldo JSON exportado) ---------------- */
app.post("/api/import", requireEditor, async (req, res) => {
  const body = req.body || {};
  const mode = body.mode === "replace" ? "replace" : "merge";
  const incomingProyectos = Array.isArray(body.proyectos) ? body.proyectos : [];
  const incomingTramites = Array.isArray(body.tramites) ? body.tramites : [];
  const incomingPagos = Array.isArray(body.pagos) ? body.pagos : [];
  const incomingSubelementos = Array.isArray(body.subelementos) ? body.subelementos : [];
  const incomingHitos = Array.isArray(body.hitos) ? body.hitos : [];

  const proyIdMap = {};
  const cleanProyectos = incomingProyectos
    .map((p) => sanitizeProyecto(p))
    .filter(Boolean)
    .map((p, i) => {
      const newId = crypto.randomUUID();
      proyIdMap[incomingProyectos[i].id] = newId;
      return Object.assign({ id: newId }, p);
    });

  const tramiteIdMap = {};
  const cleanTramites = [];
  incomingTramites.forEach((t) => {
    const mappedProyectoId = proyIdMap[t && t.proyectoId];
    if (!mappedProyectoId) return;
    // dependeDe se descarta al importar: haría referencia a ids viejos que ya no existen.
    const data = sanitizeTramite(Object.assign({}, t, { proyectoId: mappedProyectoId, dependeDe: null }));
    if (!data) return;
    const newId = crypto.randomUUID();
    if (t.id != null) tramiteIdMap[t.id] = newId;
    cleanTramites.push(Object.assign({ id: newId }, data));
  });

  const cleanPagos = incomingPagos
    .map((pg) => {
      // Un pago viene o ligado a un trámite, o (pago de paquete) ligado directo a un proyecto.
      const mappedTramiteId = pg && pg.tramiteId != null ? tramiteIdMap[pg.tramiteId] : null;
      const mappedProyectoId = pg && pg.proyectoId != null ? proyIdMap[pg.proyectoId] : null;
      if (!mappedTramiteId && !mappedProyectoId) return null;
      const data = sanitizePago(Object.assign({}, pg, { tramiteId: mappedTramiteId, proyectoId: mappedProyectoId }));
      return data ? Object.assign({ id: crypto.randomUUID() }, data) : null;
    })
    .filter(Boolean);

  const cleanSubelementos = incomingSubelementos
    .map((se) => {
      const mappedTramiteId = tramiteIdMap[se && se.tramiteId];
      if (!mappedTramiteId) return null;
      const data = sanitizeSubelemento(Object.assign({}, se, { tramiteId: mappedTramiteId }));
      return data ? Object.assign({ id: crypto.randomUUID() }, data) : null;
    })
    .filter(Boolean);

  const cleanHitos = incomingHitos
    .map((h) => {
      const mappedProyectoId = proyIdMap[h && h.proyectoId];
      if (!mappedProyectoId) return null;
      const data = sanitizeHito(Object.assign({}, h, { proyectoId: mappedProyectoId, dependeDe: null }));
      return data ? Object.assign({ id: crypto.randomUUID() }, data) : null;
    })
    .filter(Boolean);

  if (!cleanProyectos.length && !cleanTramites.length) {
    return res.status(400).json({ error: "No se encontraron proyectos ni trámites válidos en el JSON." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (mode === "replace") {
      await client.query("DELETE FROM subelementos");
      await client.query("DELETE FROM hitos");
      await client.query("DELETE FROM pagos");
      await client.query("DELETE FROM tramites");
      await client.query("DELETE FROM proyectos");
    }
    for (const p of cleanProyectos) {
      await client.query("INSERT INTO proyectos (id, nombre, ciudad, direccion, notas) VALUES ($1,$2,$3,$4,$5)", [p.id, p.nombre, p.ciudad, p.direccion, p.notas]);
    }
    for (const t of cleanTramites) {
      await client.query(
        `INSERT INTO tramites (id, proyecto_id, nombre, presupuesto, costo_gestion, costo_derechos, estatus,
          fecha_inicio, fecha_vencimiento, fecha_conclusion_real, tiempo_valor, tiempo_unidad, responsable, notas, incluir_linea_tiempo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [t.id, t.proyectoId, t.nombre, t.presupuesto, t.costoGestion, t.costoDerechos, t.estatus,
          t.fechaInicio, t.fechaVencimiento, t.fechaConclusionReal, t.tiempoValor, t.tiempoUnidad, t.responsable, t.notas, t.incluirLineaTiempo]
      );
    }
    for (const pg of cleanPagos) {
      await client.query(
        "INSERT INTO pagos (id, tramite_id, proyecto_id, tipo, monto, fecha, notas, concepto) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [pg.id, pg.tramiteId, pg.proyectoId, pg.tipo, pg.monto, pg.fecha, pg.notas, pg.concepto]
      );
    }
    for (const se of cleanSubelementos) {
      await client.query(
        "INSERT INTO subelementos (id, tramite_id, nombre, fecha, estatus, incluir_linea_tiempo) VALUES ($1,$2,$3,$4,$5,$6)",
        [se.id, se.tramiteId, se.nombre, se.fecha, se.estatus, se.incluirLineaTiempo]
      );
    }
    for (const h of cleanHitos) {
      await client.query(
        `INSERT INTO hitos (id, proyecto_id, nombre, area, fecha_inicio, fecha, estatus, responsable, notas, incluir_linea_tiempo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [h.id, h.proyectoId, h.nombre, h.area, h.fechaInicio, h.fechaVencimiento, h.estatus, h.responsable, h.notas, h.incluirLineaTiempo]
      );
    }
    await client.query("COMMIT");
    res.json({
      ok: true, proyectos: cleanProyectos.length, tramites: cleanTramites.length, pagos: cleanPagos.length,
      subelementos: cleanSubelementos.length, hitos: cleanHitos.length
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "No se pudo importar." });
  } finally {
    client.release();
  }
});

initDb()
  .then(() => {
    app.listen(PORT, () => console.log("Trámites CRAFT escuchando en el puerto " + PORT));
  })
  .catch((err) => {
    console.error("No se pudo inicializar la base de datos:", err);
    process.exit(1);
  });
