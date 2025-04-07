import { PGlite } from "@electric-sql/pglite";
import { Button } from "./ui/button";
import { useState, useEffect } from "react";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import { publicClient, pinata } from "@/utils/config";
import { abi } from "@/utils/contract";
import { createVersionManifest, DbVersionManifest } from "@/utils/dbVersioning";
import { checkDatabaseExists, clearDatabase, getLocalVersion, saveLocalVersion } from "@/utils/db";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createWalletClient, custom } from "viem";
import { baseSepolia } from "viem/chains";
import { uploadFile } from "@/utils/uploads";
import "viem/window"

let db: PGlite | undefined;

interface ToDo {
  id: number;
  task: string;
  done: boolean;
}

export default function Database() {
  const [todos, setTodos] = useState<ToDo[]>([]);
  const [taskName, setTaskName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<DbVersionManifest | null>(null);
  const [hasLocalChanges, setHasLocalChanges] = useState(false);

  async function initializeDb() {
    try {
      // Create todo table if it doesn't exist
      await db?.exec(`
        CREATE TABLE IF NOT EXISTS todo (
          id SERIAL PRIMARY KEY,
          task TEXT,
          done BOOLEAN DEFAULT false
        );
      `);
      console.log("Database table initialized");
    } catch (error) {
      console.error("Error initializing database table:", error);
      throw error;
    }
  }

  async function importDb() {
    try {
      setLoading(true);

      // Get latest CID from IPCM contract
      const manifestCid = await publicClient.readContract({
        address: import.meta.env.VITE_IPCM_CONTRACT_ADDRESS as `0x`,
        abi: abi,
        functionName: "getMapping",
      }) as string;

      if (!manifestCid) {
        // No version exists yet, create new database
        db = new PGlite({
          dataDir: "idb://todo-db",
        });
        await initializeDb();
        setTodos([]);
        setLoading(false);
        return;
      }

      // Fetch the manifest
      const manifestResponse = await pinata.gateways.public.get(manifestCid);
      const remoteManifest = manifestResponse.data as unknown as DbVersionManifest;
      console.log("Remote manifest:", remoteManifest);


      // Fetch the remote database file
      const dbFileResponse = await pinata.gateways.public.get(remoteManifest.cid);
      const dbFile = dbFileResponse.data as Blob;

      // Check if we have a local database and version
      const dbExists = await checkDatabaseExists("todo-db");
      const localVersion = await getLocalVersion();

      // Simple conflict resolution based on blockchain timestamp
      if (!dbExists) {
        // No local DB, use remote
        db = new PGlite({
          loadDataDir: dbFile,
          dataDir: "idb://todo-db",
        });
        setCurrentVersion(remoteManifest);
        await saveLocalVersion(remoteManifest);
        setHasLocalChanges(false);
      } else if (!localVersion) {
        // We have local DB but no version info - mark as having local changes
        db = new PGlite({
          dataDir: "idb://todo-db",
        });
        setHasLocalChanges(true);
      } else if (localVersion.cid === remoteManifest.cid) {
        // Same version, use local
        db = new PGlite({
          dataDir: "idb://todo-db",
        });
        setCurrentVersion(localVersion);
        setHasLocalChanges(false);
      } else {
        // Conflict resolution based on timestamp
        const useRemote = remoteManifest.blockTimestamp > (localVersion.blockTimestamp || 0);

        if (useRemote) {
          // Use remote version
          await clearDatabase("todo-db");
          db = new PGlite({
            loadDataDir: dbFile,
            dataDir: "idb://todo-db",
          });
          setCurrentVersion(remoteManifest);
          await saveLocalVersion(remoteManifest);
          setHasLocalChanges(false);
          toast("Using newer remote version");
        } else {
          // Keep local version
          db = new PGlite({
            dataDir: "idb://todo-db",
          });
          setCurrentVersion(localVersion);
          setHasLocalChanges(true);
          toast("Using local version");
        }
      }

      await initializeDb();
      await loadTodos();
      setLoading(false);
      toast("Database Loaded");
    } catch (error) {
      setLoading(false);
      console.error("Error importing database:", error);
      toast.error("Failed to import database");

      // In case of error, create a new empty database
      try {
        db = new PGlite({
          dataDir: "idb://todo-db",
        });
        await initializeDb();
        setTodos([]);
        setHasLocalChanges(false);
      } catch (fallbackError) {
        console.error("Failed to create fallback database:", fallbackError);
      }
    }
  }

  async function loadTodos() {
    const ret = await db?.query(`SELECT * from todo ORDER BY id ASC;`);
    setTodos(ret?.rows as ToDo[] || []);
  }

  async function addTodo() {
    try {
      await db?.query("INSERT INTO todo (task, done) VALUES ($1, false)", [
        taskName,
      ]);
      await loadTodos();
      setTaskName("");
      setHasLocalChanges(true);
    } catch (error) {
      console.log(error);
      toast.error("Failed to add todo");
    }
  }

  async function updateTodo(id: number, done: boolean) {
    try {
      await db?.query("UPDATE todo SET done = $1 WHERE id = $2", [done, id]);
      await loadTodos();
      setHasLocalChanges(true);
    } catch (error) {
      console.log(error);
      toast.error("Failed to update todo");
    }
  }

  async function deleteTodo(id: number) {
    try {
      await db?.query("DELETE FROM todo WHERE id = $1", [id]);
      await loadTodos();
      setHasLocalChanges(true);
    } catch (error) {
      console.log(error);
      toast.error("Failed to delete todo");
    }
  }

  async function saveDb() {
    try {
      if (!window.ethereum) {
        toast.error("Ethereum provider not found");
        return;
      }
      setSaving(true);
      const walletClient = createWalletClient({
        chain: baseSepolia,
        transport: custom(window.ethereum)
      });

      const [address] = await walletClient.requestAddresses();

      await walletClient.switchChain({ id: baseSepolia.id })

      if (!address) {
        toast.error("No wallet address found");
        setSaving(false);
        return;
      }

      // Dump database to file
      const dbFile = await db?.dumpDataDir("auto");

      // Upload database file to IPFS
      const dbCid = await uploadFile(dbFile as File);

      // Create version manifest, referencing previous version if exists
      const prevCid = currentVersion?.cid || null;
      const manifest = await createVersionManifest(dbCid, prevCid);

      // Upload manifest to IPFS
      const manifestCid = await uploadFile(manifest);

      // Update IPCM contract with new manifest CID
      const { request: contractRequest } = await publicClient.simulateContract({
        account: address,
        address: import.meta.env.VITE_IPCM_CONTRACT_ADDRESS as `0x`,
        abi: abi,
        functionName: "updateMapping",
        args: [`${manifestCid}`],
      });

      const tx = await walletClient.writeContract(contractRequest);
      await publicClient.waitForTransactionReceipt({ hash: tx });

      // Update local state
      setCurrentVersion(manifest);
      await saveLocalVersion(manifest);
      setHasLocalChanges(false);

      toast("Database Saved");
      setSaving(false);
    } catch (error) {
      setSaving(false);
      console.error("Error saving database:", error);
      toast.error("Failed to save database");
    }
  }

  function taskNameHandle(e: React.ChangeEvent<HTMLInputElement>) {
    setTaskName(e.target.value);
  }

  useEffect(() => {
    importDb();
  }, []);

  return (
    <div className="flex flex-col gap-2">
      {loading ? (
        <Loader2 className="h-12 w-12 animate-spin" />
      ) : (
        <>
          <div className="flex flex-col gap-2 items-center mb-4">
            <div className="text-sm text-muted-foreground">
              {hasLocalChanges ? (
                <span className="text-amber-500">You have unsaved local changes</span>
              ) : (
                <span className="text-green-500">Database is up to date</span>
              )}
            </div>
          </div>

          <div className="flex flex-row items-center gap-4">
            <Input value={taskName} onChange={taskNameHandle} type="text" placeholder="Enter a task" />
            <Button onClick={addTodo} disabled={!taskName.trim()}>Add Todo</Button>
          </div>

          <div className="flex flex-col gap-2 items-start">
            {todos && todos.length > 0 ? (
              todos.map((item: ToDo) => (
                <div
                  className="w-full flex items-center justify-between gap-2"
                  key={item.id}
                >
                  <div className="flex items-center gap-2">
                    <Checkbox
                      onCheckedChange={(checked) =>
                        updateTodo(item.id, checked as boolean)
                      }
                      checked={item.done}
                    />
                    <p className={item.done ? "line-through" : ""}>
                      {item.task}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="destructive"
                    onClick={() => deleteTodo(item.id)}
                  >
                    X
                  </Button>
                </div>
              ))
            ) : (
              <p>No todos yet</p>
            )}
          </div>

          <div className="w-full">
            {saving ? (
              <Button className="w-full" disabled>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </Button>
            ) : (
              <Button
                className="w-full"
                onClick={saveDb}
                variant={hasLocalChanges ? "default" : "outline"}
              >
                {hasLocalChanges ? "Save Changes" : "Save"}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
