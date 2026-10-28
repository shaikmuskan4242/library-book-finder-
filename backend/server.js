require("dotenv").config();
const express = require("express");
const cors = require("cors");
const supabase = require("./supabase");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5500,http://127.0.0.1:5500")
  .split(",").map(value => value.trim()).filter(Boolean);

app.disable("x-powered-by");
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS configuration."));
  }
}));
app.use(express.json({ limit: "32kb" }));

app.get("/api/health", async (_req, res) => {
  const { error } = await supabase.from("books").select("id", { head: true, count: "exact" });
  if (error) return res.status(503).json({ ok: false, error: "Database is not ready. Check the schema and server configuration." });
  return res.json({ ok: true, service: "library-book-finder-api", database: "connected" });
});

function validateBook(body, partial = false) {
  const errors = {};
  const fields = ["title", "author", "category"];
  for (const field of fields) {
    if (!partial || Object.prototype.hasOwnProperty.call(body, field)) {
      if (typeof body[field] !== "string" || !body[field].trim()) errors[field] = "This field is required.";
      else if (body[field].trim().length > (field === "title" ? 180 : field === "author" ? 140 : 80)) errors[field] = "Value is too long.";
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "publication_year") && body.publication_year !== null && body.publication_year !== "") {
    const year = Number(body.publication_year);
    if (!Number.isInteger(year) || year < 1000 || year > 2100) errors.publication_year = "Use a year between 1000 and 2100.";
  }
  if (Object.prototype.hasOwnProperty.call(body, "isbn") && body.isbn !== null &&
      (typeof body.isbn !== "string" || body.isbn.trim().length > 20)) errors.isbn = "ISBN must be at most 20 characters.";
  if (Object.prototype.hasOwnProperty.call(body, "description") && body.description !== null &&
      (typeof body.description !== "string" || body.description.length > 1000)) errors.description = "Description must be at most 1000 characters.";
  if (Object.prototype.hasOwnProperty.call(body, "available") && typeof body.available !== "boolean") errors.available = "Availability must be true or false.";
  const allowed = ["title", "author", "category", "publication_year", "isbn", "description", "available"];
  for (const key of Object.keys(body)) if (!allowed.includes(key)) errors[key] = "Unexpected field.";
  return errors;
}

function normalizeBook(body) {
  const normalized = {};
  for (const key of ["title", "author", "category"]) if (body[key] !== undefined) normalized[key] = body[key].trim();
  if (body.publication_year !== undefined) normalized.publication_year = body.publication_year === "" ? null : body.publication_year === null ? null : Number(body.publication_year);
  if (body.isbn !== undefined) normalized.isbn = body.isbn === null || body.isbn.trim() === "" ? null : body.isbn.trim();
  if (body.description !== undefined) normalized.description = body.description === null || body.description.trim() === "" ? null : body.description.trim();
  if (body.available !== undefined) normalized.available = body.available;
  return normalized;
}

app.get("/api/books", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  const category = typeof req.query.category === "string" ? req.query.category.trim().slice(0, 80) : "";
  const availability = req.query.available;
  if (availability !== undefined && availability !== "true" && availability !== "false") {
    return res.status(400).json({ error: "The available filter must be true or false." });
  }
  let dbQuery = supabase.from("books").select("id,title,author,category,publication_year,isbn,description,available,created_at,updated_at").order("title", { ascending: true }).limit(500);
  if (query) dbQuery = dbQuery.or(`title.ilike.%${query.replace(/[,%()]/g, "")}%,author.ilike.%${query.replace(/[,%()]/g, "")}%,category.ilike.%${query.replace(/[,%()]/g, "")}%`);
  if (category) dbQuery = dbQuery.eq("category", category);
  if (availability !== undefined) dbQuery = dbQuery.eq("available", availability === "true");
  const { data, error } = await dbQuery;
  if (error) return res.status(500).json({ error: "Could not retrieve books from the database." });
  return res.json({ data });
});

app.get("/api/books/:id", async (req, res) => {
  const { data, error } = await supabase.from("books").select("*").eq("id", req.params.id).maybeSingle();
  if (error) return res.status(400).json({ error: "Invalid book ID or database query." });
  if (!data) return res.status(404).json({ error: "Book not found." });
  return res.json({ data });
});

app.post("/api/books", async (req, res) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) return res.status(400).json({ error: "Send a JSON object." });
  const errors = validateBook(req.body);
  if (Object.keys(errors).length) return res.status(400).json({ error: "Please correct the submitted fields.", details: errors });
  const { data, error } = await supabase.from("books").insert(normalizeBook(req.body)).select("*").single();
  if (error) return res.status(500).json({ error: error.code === "23505" ? "A book with this ISBN already exists." : "Could not save the book. Check database constraints and configuration." });
  return res.status(201).json({ data });
});

app.put("/api/books/:id", async (req, res) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) return res.status(400).json({ error: "Send a JSON object." });
  const errors = validateBook(req.body, true);
  if (!Object.keys(req.body).length) errors.body = "Provide at least one field to update.";
  if (Object.keys(errors).length) return res.status(400).json({ error: "Please correct the submitted fields.", details: errors });
  const { data, error } = await supabase.from("books").update(normalizeBook(req.body)).eq("id", req.params.id).select("*").maybeSingle();
  if (error) return res.status(400).json({ error: error.code === "23505" ? "A book with this ISBN already exists." : "Could not update the book." });
  if (!data) return res.status(404).json({ error: "Book not found." });
  return res.json({ data });
});

app.delete("/api/books/:id", async (req, res) => {
  const { data, error } = await supabase.from("books").delete().eq("id", req.params.id).select("id").maybeSingle();
  if (error) return res.status(400).json({ error: "Could not delete the book. Check the ID and database permissions." });
  if (!data) return res.status(404).json({ error: "Book not found." });
  return res.json({ message: "Book deleted successfully.", id: data.id });
});

app.use((req, res) => res.status(404).json({ error: "Route not found." }));
app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && "body" in error) return res.status(400).json({ error: "Invalid JSON request body." });
  if (error.message === "Origin is not allowed by CORS configuration.") return res.status(403).json({ error: error.message });
  console.error("Unexpected server error:", error.message);
  return res.status(500).json({ error: "Unexpected server error." });
});

app.listen(PORT, () => console.log(`Library Book Finder API listening on http://localhost:${PORT}`));
