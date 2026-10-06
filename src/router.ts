import { createRouter, createWebHistory } from 'vue-router'
import Overview from './views/Overview.vue'
import Station from './views/Station.vue'
import Constructions from './views/Constructions.vue'
import Cases from './views/Cases.vue'
import Execution from './views/Execution.vue'
import Release from './views/Release.vue'

export default createRouter({
  history:createWebHistory(),
  routes:[
    { path:'/',name:'overview',component:Overview },
    { path:'/station',name:'station',component:Station },
    { path:'/constructions',name:'constructions',component:Constructions },
    { path:'/cases',name:'cases',component:Cases },
    { path:'/execution',name:'execution',component:Execution },
    { path:'/release',name:'release',component:Release },
  ],
})
