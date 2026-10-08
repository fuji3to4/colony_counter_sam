export async function requestPersistentStorage(storage) {
  if (typeof storage?.persist !== "function") return false;
  try {
    return (await storage.persist()) === true;
  } catch (e) {
    console.warn("Persistent storage request failed; continuing to load the model.", e);
    return false;
  }
}
