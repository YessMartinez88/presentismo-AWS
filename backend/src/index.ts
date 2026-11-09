import { createApp } from './app';
import { config } from './config';
import { closePools, getPool } from './db/pool';

// Falla rápido y con mensaje claro si la base no está disponible, en vez de fallar en el primer request.
await getPool();

const server = createApp().listen(config.port, () => {
  console.log(`API escuchando en http://localhost:${config.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => closePools().finally(() => process.exit(0)));
  });
}
