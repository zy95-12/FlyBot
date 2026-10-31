import { createApi } from './api.js'
import { mountWorkbench } from './app.js'
import './styles.css'
mountWorkbench(document.getElementById('workbench-root'), createApi())
