import './ui/styles.css';
import { AppController } from './ui/AppController';

const mount = document.getElementById('app');
if (!mount) {
  throw new Error('Root #app element missing');
}

const app = new AppController(mount);
app.init();
