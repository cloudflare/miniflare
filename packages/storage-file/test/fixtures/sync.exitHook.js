import { FileMutex } from "../..";
// Acquire lock at path process.argv[2]...
const mutex = new FileMutex(process.argv[2]);
// ...but terminate process (exitHook should cleanup lock)
void mutex.runWith(async () => process.exit(42));
