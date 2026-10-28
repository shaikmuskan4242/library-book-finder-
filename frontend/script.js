(() => {
  "use strict";
  const API_BASE = (window.LIBRARY_API_BASE || "http://localhost:3000/api").replace(/\/+$/, "");
  const $ = (id) => document.getElementById(id);
  const els = {
    grid: $("book-grid"), count: $("book-count"), search: $("search-input"),
    category: $("category-filter"), availability: $("availability-filter"),
    notice: $("notice"), empty: $("empty-state"), form: $("book-form"),
    id: $("book-id"), title: $("book-title"), author: $("book-author"),
    categoryInput: $("book-category"), year: $("book-year"), isbn: $("book-isbn"),
    description: $("book-description"), available: $("book-available"),
    heading: $("form-heading"), save: $("save-book"), cancel: $("cancel-edit"),
    connection: $("connection-status"), dialog: $("delete-dialog")
  };
  let books = [];
  let pendingDeleteId = null;
  let noticeTimer = null;
  const palette = ["cover-1","cover-2","cover-3","cover-4","cover-5","cover-6","cover-7","cover-8"];
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const safeYear = (value) => value ? String(value) : "Year not listed";

  function showNotice(message, type = "success") {
    clearTimeout(noticeTimer);
    els.notice.textContent = message;
    els.notice.className = `notice ${type}`;
    els.notice.hidden = false;
    noticeTimer = setTimeout(() => { els.notice.hidden = true; }, 5500);
  }
  async function request(path = "/books", options = {}) {
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: { "Content-Type": "application/json", ...(options.headers || {}) }
      });
    } catch {
      throw new Error("Cannot reach the backend. Start the server and check the API URL.");
    }
    let payload;
    try { payload = await response.json(); } catch { payload = {}; }
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
    return payload;
  }
  function setLoading(message = "Loading collection…") {
    els.grid.innerHTML = `<div class="loading-state">${escapeHTML(message)}</div>`;
    els.count.textContent = "Please wait";
  }
  async function loadBooks() {
    setLoading();
    try {
      const result = await request("/books");
      books = Array.isArray(result.data) ? result.data : [];
      updateCategories();
      renderBooks();
      els.connection.innerHTML = '<span class="status-dot" style="background:#6ec594"></span> Backend connected';
    } catch (error) {
      books = [];
      renderBooks();
      els.count.textContent = "Connection needed";
      els.connection.innerHTML = '<span class="status-dot" style="background:#e5a46e"></span> Backend unavailable';
      showNotice(`${error.message} Book records require a configured Supabase database.`, "error");
    }
  }
  function updateCategories() {
    const selected = els.category.value;
    const categories = [...new Set(books.map(b => b.category).filter(Boolean))].sort((a,b) => a.localeCompare(b));
    els.category.innerHTML = '<option value="">All categories</option>' + categories.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("");
    if (categories.includes(selected)) els.category.value = selected;
  }
  function filteredBooks() {
    const query = els.search.value.trim().toLocaleLowerCase();
    return books.filter(book => {
      const searchable = [book.title, book.author, book.category, book.isbn, book.description].join(" ").toLocaleLowerCase();
      const queryMatch = !query || searchable.includes(query);
      const categoryMatch = !els.category.value || book.category === els.category.value;
      const availabilityMatch = !els.availability.value || (els.availability.value === "available" ? book.available : !book.available);
      return queryMatch && categoryMatch && availabilityMatch;
    });
  }
  function renderBooks() {
    const visible = filteredBooks();
    els.count.textContent = `${visible.length} ${visible.length === 1 ? "book" : "books"} found`;
    els.empty.hidden = visible.length !== 0;
    if (!visible.length) { els.grid.innerHTML = ""; return; }
    els.grid.innerHTML = visible.map((book, index) => {
      const title = escapeHTML(book.title);
      const author = escapeHTML(book.author);
      const category = escapeHTML(book.category);
      const cover = palette[index % palette.length];
      const titleWords = title.length > 27 ? `${title.slice(0, 25)}…` : title;
      return `<article class="book-card">
        <div class="book-cover ${cover}"><span class="cover-kicker">${category} · LIBRARY EDITION</span><span class="cover-title">${titleWords}</span><span class="cover-author">${author}</span></div>
        <div class="book-card-body"><span class="book-category">${category}</span><h3>${title}</h3><p class="book-author">by ${author}</p>
        <div class="book-meta"><span>${escapeHTML(safeYear(book.publication_year))}</span><span class="availability ${book.available ? "" : "unavailable"}">${book.available ? "Available" : "Checked out"}</span></div>
        <div class="card-actions"><button type="button" data-action="edit" data-id="${escapeHTML(book.id)}">Edit</button><button type="button" class="delete-action" data-action="delete" data-id="${escapeHTML(book.id)}">Delete</button></div></div>
      </article>`;
    }).join("");
  }
  function resetForm() {
    els.form.reset(); els.id.value = ""; els.available.checked = true;
    els.heading.textContent = "Add a new book"; els.save.innerHTML = 'Save book <span>→</span>';
    els.cancel.hidden = true;
  }
  function editBook(id) {
    const book = books.find(item => String(item.id) === String(id));
    if (!book) { showNotice("That book could not be found. Refresh the collection.", "error"); return; }
    els.id.value = book.id; els.title.value = book.title || ""; els.author.value = book.author || "";
    els.categoryInput.value = book.category || ""; els.year.value = book.publication_year || "";
    els.isbn.value = book.isbn || ""; els.description.value = book.description || "";
    els.available.checked = Boolean(book.available);
    els.heading.textContent = "Edit book details"; els.save.innerHTML = 'Update book <span>→</span>';
    els.cancel.hidden = false; $("manage").scrollIntoView({ behavior: "smooth" }); els.title.focus({ preventScroll: true });
  }
  async function saveBook(event) {
    event.preventDefault();
    if (!els.form.reportValidity()) return;
    const year = els.year.value ? Number(els.year.value) : null;
    if (year !== null && (!Number.isInteger(year) || year < 1000 || year > 2100)) {
      showNotice("Enter a publication year between 1000 and 2100.", "error"); els.year.focus(); return;
    }
    const body = {
      title: els.title.value.trim(), author: els.author.value.trim(),
      category: els.categoryInput.value.trim(), publication_year: year,
      isbn: els.isbn.value.trim() || null, description: els.description.value.trim() || null,
      available: els.available.checked
    };
    const isEdit = Boolean(els.id.value);
    els.save.disabled = true; els.save.textContent = isEdit ? "Updating…" : "Saving…";
    try {
      const result = await request(isEdit ? `/books/${encodeURIComponent(els.id.value)}` : "/books", {
        method: isEdit ? "PUT" : "POST", body: JSON.stringify(body)
      });
      resetForm();
      await loadBooks();
      showNotice(isEdit ? "Book updated successfully." : "Book added successfully.");
      if (result.data && !books.some(b => String(b.id) === String(result.data.id))) {
        books.unshift(result.data); updateCategories(); renderBooks();
      }
    } catch (error) { showNotice(error.message, "error"); }
    finally { els.save.disabled = false; els.save.innerHTML = els.id.value ? 'Update book <span>→</span>' : 'Save book <span>→</span>'; }
  }
  function askDelete(id) {
    if (!books.some(book => String(book.id) === String(id))) { showNotice("That book could not be found.", "error"); return; }
    pendingDeleteId = id;
    if (typeof els.dialog.showModal === "function") els.dialog.showModal();
    else if (window.confirm("Delete this book?")) deleteBook();
  }
  async function deleteBook() {
    if (pendingDeleteId === null) return;
    const id = pendingDeleteId; pendingDeleteId = null;
    const confirmButton = $("confirm-delete");
    confirmButton.disabled = true; confirmButton.textContent = "Deleting…";
    try {
      await request(`/books/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (els.dialog.open) els.dialog.close("confirm");
      if (String(els.id.value) === String(id)) resetForm();
      await loadBooks(); showNotice("Book deleted successfully.");
    } catch (error) { showNotice(error.message, "error"); }
    finally { confirmButton.disabled = false; confirmButton.textContent = "Delete book"; }
  }
  els.form.addEventListener("submit", saveBook);
  els.cancel.addEventListener("click", resetForm);
  els.search.addEventListener("input", renderBooks);
  els.category.addEventListener("change", renderBooks);
  els.availability.addEventListener("change", renderBooks);
  $("clear-filters").addEventListener("click", () => { els.search.value = ""; els.category.value = ""; els.availability.value = ""; renderBooks(); });
  $("empty-clear").addEventListener("click", () => { els.search.value = ""; els.category.value = ""; els.availability.value = ""; renderBooks(); });
  els.grid.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    if (button.dataset.action === "edit") editBook(button.dataset.id);
    if (button.dataset.action === "delete") askDelete(button.dataset.id);
  });
  $("confirm-delete").addEventListener("click", event => { event.preventDefault(); deleteBook(); });
  els.dialog.addEventListener("close", () => { if (els.dialog.returnValue !== "confirm") pendingDeleteId = null; });
  $("year-now").textContent = new Date().getFullYear();
  loadBooks();
})();