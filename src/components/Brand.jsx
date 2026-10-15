export default function Brand({compact=false}) {
  return <div className={'brand'+(compact?' brand-compact':'')}>
    <img className="brand-mark" src="./icon-192.png" alt="" width={compact?52:64} height={compact?52:64}/>
    <div className="brand-copy">
      <div className="brand-name">POS Pro</div>
      <div className="brand-scope">ERP・點餐・CRM</div>
      <div className="brand-promise">所有店家，全部功能免費</div>
    </div>
  </div>
}
