import sqlite3 from "better-sqlite3";
const db = sqlite3("delta_currency.db");
db.prepare(`CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY, name TEXT)`).run();
db.prepare("INSERT INTO test (name) VALUES (?)").run("hello");
console.log(db.prepare("SELECT * FROM test").all());
