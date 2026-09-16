// MongoDB lease kilitleri temizleme scripti
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("❌ MONGODB_URI bulunamadı!");
  process.exit(1);
}

const client = new MongoClient(uri);

try {
  await client.connect();
  const db = client.db("ROAR");
  
  const result = await db.collection("leases").deleteMany({});
  console.log(`✅ ${result.deletedCount} adet lease kilidi temizlendi!`);
  
} catch (error) {
  console.error("❌ Hata:", error.message);
} finally {
  await client.close();
  process.exit(0);
}
