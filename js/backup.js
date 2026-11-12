export function buildBackup({ files, stars, notes, processOrders, exportedAt }) {
  return {
    app: "hx-wip-tracker",
    version: 3,
    exportedAt: exportedAt || new Date().toISOString(),
    files: files || [],
    stars: (stars || []).map((item) => ({
      id: item.id,
      supplier: item.supplier,
      prodNo: item.prodNo,
    })),
    notes: (notes || []).map((item) => ({
      id: item.id,
      supplier: item.supplier,
      prodNo: item.prodNo,
      note: item.note || "",
    })),
    processOrders: (processOrders || []).map((item) => ({
      supplier: item.supplier,
      items: (item.items || []).map((step) => ({ name: step.name, seq: step.seq })),
    })),
  };
}

export function readBackup(payload) {
  if (!payload || payload.app !== "hx-wip-tracker" || !Array.isArray(payload.files)) {
    throw new Error("不是本工具导出的备份");
  }
  const files = payload.files.filter((item) => item && item.id && item.supplier && item.kind);
  const stars = Array.isArray(payload.stars) ? payload.stars.filter((item) => item && item.supplier && item.prodNo).map((item) => ({
    id: `${item.supplier}|${item.prodNo}`,
    supplier: item.supplier,
    prodNo: item.prodNo,
  })) : [];
  const notes = Array.isArray(payload.notes) ? payload.notes.filter((item) => item && item.supplier && item.prodNo).map((item) => ({
    id: `${item.supplier}|${item.prodNo}`,
    supplier: item.supplier,
    prodNo: item.prodNo,
    note: String(item.note || ""),
  })) : [];
  const processOrders = Array.isArray(payload.processOrders) ? payload.processOrders.filter((item) => item && (item.supplier === "奔强" || item.supplier === "捷德")).map((item) => ({
    supplier: item.supplier,
    items: Array.isArray(item.items) ? item.items.filter((step) => step && step.name != null && Number.isFinite(Number(step.seq))).map((step) => ({
      name: String(step.name),
      seq: Number(step.seq),
    })) : [],
  })) : null;
  return { files, stars, notes, processOrders };
}
