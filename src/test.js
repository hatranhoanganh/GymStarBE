import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config(); // ← quan trọng, load .env

const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoyLCJlbWFpbCI6InF1YW50cml2aWVuQG1haWxpbmF0b3IuY29tIiwicm9sZSI6Miwicm9sZV9uYW1lIjoiUXXhuqNuIHRy4buLIHZpw6puIiwiaWF0IjoxNzY1MjkxMzQzLCJleHAiOjE3NjY1ODczNDN9.6ymcwRvsyp-ZW7EZOhvHTIWE6XVsON0VcSrrEz54XJI";

try {
  const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
  console.log("Token hợp lệ:", decoded);
} catch (err) {
  console.error(err.name, err.message);
}
