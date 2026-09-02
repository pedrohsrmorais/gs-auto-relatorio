const mysql = require('mysql2/promise');

// Pool de conexões compartilhado por toda a aplicação.
// Todos os controllers importam { pool } daqui — nunca abrem conexão própria.
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'studio_fiscal',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
  queueLimit: 0,
  dateStrings: true,      // DATE/DATETIME voltam como string 'YYYY-MM-DD', sem timezone shift
  decimalNumbers: true,   // DECIMAL volta como number, não como string
});

module.exports = { pool };
