require('dotenv').config({ quiet: true });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const apiRoutes = require('./routes');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');

if (!process.env.JWT_ACCESS_SECRET) {
  // Falha rápido: sem isso, todo login emitiria tokens que ninguém consegue validar.
  throw new Error('JWT_ACCESS_SECRET não definido. Configure o .env (veja .env.example).');
}

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '2mb' })); // limite maior que o default por causa dos imports em bulk (DARF/SPED)
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.get('/health', (req, res) => res.json({ success: true, data: { status: 'ok' } }));

app.use('/api', apiRoutes);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Studio Fiscal API rodando na porta ${PORT}`);
  });
}

module.exports = app;
