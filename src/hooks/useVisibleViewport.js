import {useEffect,useState} from 'react'
// Mobile keyboards may shrink the visual viewport without resizing layout.
export default function useVisibleViewport(){
  const measure=()=>{const v=window.visualViewport;return {height:v?.height||window.innerHeight,top:v?.offsetTop||0,bottom:Math.max(0,window.innerHeight-(v?.height||window.innerHeight)-(v?.offsetTop||0))}}
  const [viewport,setViewport]=useState(measure)
  useEffect(()=>{
    const v=window.visualViewport,update=()=>setViewport(measure())
    update();v?.addEventListener('resize',update);v?.addEventListener('scroll',update);window.addEventListener('resize',update)
    return()=>{v?.removeEventListener('resize',update);v?.removeEventListener('scroll',update);window.removeEventListener('resize',update)}
  },[])
  return viewport
}
