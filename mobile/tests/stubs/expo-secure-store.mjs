const m = new Map();
export const setItemAsync = async (k, v) => { m.set(k, v); };
export const getItemAsync = async (k) => m.get(k) ?? null;
export const deleteItemAsync = async (k) => { m.delete(k); };
