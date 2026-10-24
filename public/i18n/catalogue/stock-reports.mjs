const rows={
 '讀取中…':['Loading…','読み込み中…','读取中…'],
 '重試':['Retry','再試行','重试'],
 '實際成本':['Actual cost','実際原価','实际成本'],
 '參考成本':['Reference cost','参考原価','参考成本'],
 '收銀與餐飲':['Checkout & meals','レジ・飲食','收银与餐饮'],
 '報表暫時無法讀取':['Report unavailable','レポートを読み取れません','报表暂时无法读取'],
 '看原因':['Show reason','理由を見る','看原因'],
 '成本分攤需要核對':['Check cost allocation','原価配分を確認してください','成本分摊需要核对'],
 '其他收入調整':['Other revenue adjustments','その他収益の調整','其他收入调整'],
 '未分配成本調整':['Unallocated cost adjustments','未配分の原価調整','未分配成本调整'],
}
export default Object.fromEntries(Object.entries(rows).map(([key,row],index)=>[key,[...row,13000+index]]))
