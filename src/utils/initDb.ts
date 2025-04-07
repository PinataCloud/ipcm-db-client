import { publicClient, walletClient } from "@/utils/config";
import { account } from "@/utils/account";
import { abi } from "@/utils/contract";
import { PGlite } from "@electric-sql/pglite";
import { uploadFile } from "./uploads";
import { createVersionManifest } from "./dbVersioning";

(async () => {
  // Initialize the database with the todo table
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS todo (
      id SERIAL PRIMARY KEY,
      task TEXT,
      done BOOLEAN DEFAULT false
    );
  `);


  await db?.query("INSERT INTO todo (task, done) VALUES ($1, false)", [
    "Store data on IPFS",
  ]);

  // Dump the database to a file
  const dbFile = (await db.dumpDataDir("auto")) as File;

  // Upload the database file to IPFS and get CID
  const dbCid = await uploadFile(dbFile);

  // Create a version manifest with blockchain timestamp
  const manifest = await createVersionManifest(dbCid, null, ["Initial database creation"]);

  // Upload the manifest to IPFS
  const manifestCid = await uploadFile(manifest);

  // Update the IPCM contract with the manifest CID
  const { request: contractRequest } = await publicClient.simulateContract({
    account,
    address: import.meta.env.VITE_IPCM_CONTRACT_ADDRESS as `0x`,
    abi: abi,
    functionName: "updateMapping",
    args: [manifestCid],
  });

  const tx = await walletClient.writeContract(contractRequest);
  console.log("Database initialized with transaction:", tx);
})();
