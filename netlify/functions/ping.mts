import type { Config } from "@netlify/functions";

export default async (req: Request) => {
  try {
    await fetch("https://nmuybthoprymzuafjuit.supabase.co/rest/v1/debug_log", {
      method: "POST",
      headers: {
        apikey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tdXlidGhvcHJ5bXp1YWZqdWl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzU0MzUsImV4cCI6MjA5MjM1MTQzNX0.M1tHyawyqGB2Uo0Iv6G6WNJmKnnFICBSBOrB2wmiHTs",
        Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tdXlidGhvcHJ5bXp1YWZqdWl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzU0MzUsImV4cCI6MjA5MjM1MTQzNX0.M1tHyawyqGB2Uo0Iv6G6WNJmKnnFICBSBOrB2wmiHTs",
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ step: "PING", status: "alive", detail: "function executed" }),
    });
  } catch (e) {}

  return new Response("<?xml version='1.0' encoding='UTF-8'?><Response></Response>", {
    headers: { "Content-Type": "text/xml" },
  });
};

export const config: Config = { path: "/api/ping" };
