// Small wrapper around the REST API. Every call returns parsed JSON or throws an Error.
const API = {
  async request(path, options = {}) {
    const res = await fetch(`/api${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (res.status === 204) return null;

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = Array.isArray(data.detail)
        ? data.detail.map((d) => d.msg).join("; ")
        : data.detail;
      throw new Error(detail || `Request failed (${res.status})`);
    }
    return data;
  },

  list: (params) => API.request(`/transcriptions?${new URLSearchParams(params)}`),
  stats: () => API.request("/transcriptions/stats"),
  get: (id) => API.request(`/transcriptions/${id}`),
  create: (body) => API.request("/transcriptions", { method: "POST", body: JSON.stringify(body) }),
  update: (id, body) => API.request(`/transcriptions/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (id) => API.request(`/transcriptions/${id}`, { method: "DELETE" }),
};
