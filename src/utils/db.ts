import { DbVersionManifest } from "./dbVersioning";

export async function checkDatabaseExists(dbName: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName);

    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      db.close();
      resolve(true);
    };

    request.onerror = () => {
      reject(new Error("Error opening database"));
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      db.close();
      resolve(false);
    };
  });
}

// Store version information locally
export async function saveLocalVersion(version: DbVersionManifest): Promise<void> {
  localStorage.setItem('db_version', JSON.stringify(version));
}

// Get the current local version
export async function getLocalVersion(): Promise<DbVersionManifest | null> {
  const versionString = localStorage.getItem('db_version');
  if (!versionString) return null;

  try {
    return JSON.parse(versionString) as DbVersionManifest;
  } catch (error) {
    console.error("Error parsing local version:", error);
    return null;
  }
}

export async function clearDatabase(dbName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);

    request.onsuccess = () => {
      console.log(`Database ${dbName} deleted successfully`);
      resolve();
    };

    request.onerror = () => {
      console.error(`Error deleting database ${dbName}`);
      reject(new Error("Could not delete database"));
    };
  });
}
