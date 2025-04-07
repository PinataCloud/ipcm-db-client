import { PGlite } from "@electric-sql/pglite";
import { Button } from "./ui/button";
import { useState, useEffect } from "react";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import { publicClient, pinata } from "@/utils/config";
import { abi } from "@/utils/contract"
import { createVersionManifest, DbVersionManifest } from "@/utils/dbVersioning";
import { checkDatabaseExists } from "@/utils/db";
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { createWalletClient, custom } from "viem";
import { baseSepolia } from "viem/chains";
import 'viem/window';
import { uploadFile } from "@/utils/uploads";


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
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);

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

      // Fetch the manifest
      const manifestResponse = await pinata.gateways.public.get(manifestCid);
      const manifest = manifestResponse.data as unknown as DbVersionManifest;
      console.log(manifest)

      setCurrentVersion(manifestCid);

      // Fetch the actual database file
      const dbFile = await pinata.gateways.public.get(manifest.cid);
      const file = dbFile.data as Blob;
      console.log(file)

      // Load database
      const dbExists = await checkDatabaseExists("todo-db");
      if (!dbExists) {
        db = new PGlite({
          loadDataDir: file,
          dataDir: "idb://todo-db",
        });
        console.log("Used remote db");
      } else {
        // Check for local modifications and compare timestamps
        // This would require additional logic to handle conflicts
        db = new PGlite({
          dataDir: "idb://todo-db",
        });
        console.log("Used local db");
      }

      // Initialize database structure if needed
      await initializeDb();

      // Now query the todo table
      const ret = await db?.query(`SELECT * from todo ORDER BY id ASC;`);
      setTodos(ret?.rows as ToDo[] || []);

      toast("Database Restored");
      setLoading(false);
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
      } catch (fallbackError) {
        console.error("Failed to create fallback database:", fallbackError);
      }
    }
  }

  async function addTodo() {
    try {
      await db?.query("INSERT INTO todo (task, done) VALUES ($1, false)", [
        taskName,
      ]);
      const ret = await db?.query(`
        SELECT * from todo ORDER BY id ASC;
      `);
      setTodos(ret?.rows as ToDo[]);
      setTaskName("");
      console.log(ret?.rows);
    } catch (error) {
      console.log(error);
      toast.error("Failed to add todo");
    }
  }

  async function updateTodo(id: number, done: boolean) {
    try {
      await db?.query("UPDATE todo SET done = $1 WHERE id = $2", [done, id]);
      const ret = await db?.query("SELECT * from todo ORDER BY ID ASC;");
      setTodos(ret?.rows as ToDo[]);
    } catch (error) {
      console.log(error);
      toast.error("Failed to update todo");
    }
  }

  async function deleteTodo(id: number) {
    try {
      await db?.query("DELETE FROM todo WHERE id = $1", [id]);
      const ret = await db?.query("SELECT * from todo ORDER BY ID ASC;");
      setTodos(ret?.rows as ToDo[]);
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

      const dbFile = await db?.dumpDataDir("auto");

      const dbCid = await uploadFile(dbFile as File);

      // Create version manifest with blockchain timestamp
      const manifest = await createVersionManifest(dbCid, currentVersion);

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
      setCurrentVersion(manifestCid);

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
              <Button className="w-full" onClick={saveDb}>
                Save
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
