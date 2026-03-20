import app from "./app";
import { PORT } from "./config";

app.listen(PORT, () => {
  console.log(`Church backend API running on http://localhost:${PORT}`);
});
