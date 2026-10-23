const rows={
 '修改建單來源':['Edit the source','入力内容を変更','修改建单来源'],
 '修改供應商與日期':['Edit supplier and date','仕入先と日付を変更','修改供应商与日期']
}
export default Object.fromEntries(Object.entries(rows).map(([key,value],index)=>[key,[...value,38100+index]]))
