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
const HITO_AREAS = ["comercial", "obra", "due_diligence", "otro"];

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
      ciudad TEXT NOT NULL,
      notas TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
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
  return { id: row.id, nombre: row.nombre, ciudad: row.ciudad, notas: row.notas || "" };
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
    incluirLineaTiempo: row.incluir_linea_tiempo !== false
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
    fecha: dateStr(row.fecha) || "", estatus: row.estatus, notas: row.notas || "",
    incluirLineaTiempo: row.incluir_linea_tiempo !== false
  };
}

function sanitizeProyecto(body) {
  const nombre = String((body && body.nombre) || "").trim();
  const ciudad = String((body && body.ciudad) || "").trim();
  if (!nombre || !ciudad) return null;
  return { nombre, ciudad, notas: String((body && body.notas) || "").trim() };
}

function sanitizeTramite(body) {
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
    incluirLineaTiempo: body.incluirLineaTiempo === false ? false : true
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

function sanitizeHito(body) {
  const proyectoId = String((body && body.proyectoId) || "").trim();
  const nombre = String((body && body.nombre) || "").trim();
  if (!proyectoId || !nombre) return null;
  const area = HITO_AREAS.includes(body.area) ? body.area : "otro";
  const estatus = ESTATUS_VALIDOS.includes(body.estatus) ? body.estatus : "en_proceso";
  return {
    proyectoId, nombre, area,
    fecha: body.fecha ? String(body.fecha).slice(0, 10) : null,
    estatus,
    notas: String((body && body.notas) || "").trim(),
    incluirLineaTiempo: body.incluirLineaTiempo === false ? false : true
  };
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
    const [proyectos, tramites, pagos, subelementos, hitos] = await Promise.all([
      pool.query("SELECT * FROM proyectos ORDER BY nombre ASC"),
      pool.query("SELECT * FROM tramites ORDER BY fecha_vencimiento ASC NULLS LAST"),
      pool.query("SELECT * FROM pagos ORDER BY fecha DESC NULLS LAST"),
      pool.query("SELECT * FROM subelementos ORDER BY fecha ASC NULLS LAST"),
      pool.query("SELECT * FROM hitos ORDER BY fecha ASC NULLS LAST")
    ]);
    res.json({
      proyectos: proyectos.rows.map(proyectoRowToItem),
      tramites: tramites.rows.map(tramiteRowToItem),
      pagos: pagos.rows.map(pagoRowToItem),
      subelementos: subelementos.rows.map(subelementoRowToItem),
      hitos: hitos.rows.map(hitoRowToItem)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo leer la base de datos." });
  }
});

/* ---------------- Proyectos ---------------- */
app.post("/api/proyectos", requireEditor, async (req, res) => {
  const data = sanitizeProyecto(req.body);
  if (!data) return res.status(400).json({ error: "Completa el nombre y la ciudad del proyecto." });
  const id = crypto.randomUUID();
  try {
    const result = await pool.query(
      "INSERT INTO proyectos (id, nombre, ciudad, notas) VALUES ($1,$2,$3,$4) RETURNING *",
      [id, data.nombre, data.ciudad, data.notas]
    );
    res.status(201).json(proyectoRowToItem(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo guardar el proyecto." });
  }
});

app.put("/api/proyectos/:id", requireEditor, async (req, res) => {
  const data = sanitizeProyecto(req.body);
  if (!data) return res.status(400).json({ error: "Completa el nombre y la ciudad del proyecto." });
  try {
    const result = await pool.query(
      "UPDATE proyectos SET nombre=$1, ciudad=$2, notas=$3, updated_at=now() WHERE id=$4 RETURNING *",
      [data.nombre, data.ciudad, data.notas, req.params.id]
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
        fecha_inicio, fecha_vencimiento, fecha_conclusion_real, tiempo_valor, tiempo_unidad, responsable, notas, incluir_linea_tiempo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [id, data.proyectoId, data.nombre, data.presupuesto, data.costoGestion, data.costoDerechos, data.estatus,
        data.fechaInicio, data.fechaVencimiento, data.fechaConclusionReal, data.tiempoValor, data.tiempoUnidad,
        data.responsable, data.notas, data.incluirLineaTiempo]
    );
    res.status(201).json(tramiteRowToItem(result.rows[0]));
  } catch (err) {
    console.error(err);
    if (err.code === "23503") return res.status(400).json({ error: "El proyecto seleccionado no existe." });
    res.status(500).json({ error: "No se pudo guardar el trámite." });
  }
});

app.put("/api/tramites/:id", requireEditor, async (req, res) => {
  const data = sanitizeTramite(req.body || {});
  if (!data) return res.status(400).json({ error: "Faltan campos obligatorios (trámite, proyecto, vencimiento)." });
  try {
    const result = await pool.query(
      `UPDATE tramites SET proyecto_id=$1, nombre=$2, presupuesto=$3, costo_gestion=$4, costo_derechos=$5,
        estatus=$6, fecha_inicio=$7, fecha_vencimiento=$8, fecha_conclusion_real=$9, tiempo_valor=$10,
        tiempo_unidad=$11, responsable=$12, notas=$13, incluir_linea_tiempo=$14, updated_at=now() WHERE id=$15 RETURNING *`,
      [data.proyectoId, data.nombre, data.presupuesto, data.costoGestion, data.costoDerechos, data.estatus,
        data.fechaInicio, data.fechaVencimiento, data.fechaConclusionReal, data.tiempoValor, data.tiempoUnidad,
        data.responsable, data.notas, data.incluirLineaTiempo, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Trámite no encontrado." });
    res.json(tramiteRowToItem(result.rows[0]));
  } catch (err) {
    console.error(err);
    if (err.code === "23503") return res.status(400).json({ error: "El proyecto seleccionado no existe." });
    res.status(500).json({ error: "No se pudo actualizar el trámite." });
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
  if (!data) return res.status(400).json({ error: "Completa el proyecto y el nombre del hito." });
  const id = crypto.randomUUID();
  try {
    const result = await pool.query(
      "INSERT INTO hitos (id, proyecto_id, nombre, area, fecha, estatus, notas, incluir_linea_tiempo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [id, data.proyectoId, data.nombre, data.area, data.fecha, data.estatus, data.notas, data.incluirLineaTiempo]
    );
    res.status(201).json(hitoRowToItem(result.rows[0]));
  } catch (err) {
    console.error(err);
    if (err.code === "23503") return res.status(400).json({ error: "El proyecto seleccionado no existe." });
    res.status(500).json({ error: "No se pudo guardar el hito." });
  }
});

app.put("/api/hitos/:id", requireEditor, async (req, res) => {
  const data = sanitizeHito(req.body || {});
  if (!data) return res.status(400).json({ error: "Completa el proyecto y el nombre del hito." });
  try {
    const result = await pool.query(
      `UPDATE hitos SET proyecto_id=$1, nombre=$2, area=$3, fecha=$4, estatus=$5, notas=$6, incluir_linea_tiempo=$7, updated_at=now()
       WHERE id=$8 RETURNING *`,
      [data.proyectoId, data.nombre, data.area, data.fecha, data.estatus, data.notas, data.incluirLineaTiempo, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Hito no encontrado." });
    res.json(hitoRowToItem(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo actualizar el hito." });
  }
});

app.delete("/api/hitos/:id", requireEditor, async (req, res) => {
  try {
    await pool.query("DELETE FROM hitos WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo eliminar el hito." });
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
    const data = sanitizeTramite(Object.assign({}, t, { proyectoId: mappedProyectoId }));
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
      const data = sanitizeHito(Object.assign({}, h, { proyectoId: mappedProyectoId }));
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
      await client.query("INSERT INTO proyectos (id, nombre, ciudad, notas) VALUES ($1,$2,$3,$4)", [p.id, p.nombre, p.ciudad, p.notas]);
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
        "INSERT INTO hitos (id, proyecto_id, nombre, area, fecha, estatus, notas, incluir_linea_tiempo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [h.id, h.proyectoId, h.nombre, h.area, h.fecha, h.estatus, h.notas, h.incluirLineaTiempo]
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
