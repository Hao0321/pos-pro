const rows={
 '成本紀錄':['Cost records','原価記録','成本记录'],
 '其他紀錄':['Other records','その他の記録','其他记录'],
 '成本帳請使用完整備份還原預覽，不能部分同步':['Use a complete backup preview to restore cost records; partial sync is unavailable.','原価記録は完全なバックアップのプレビューから復元してください。部分同期はできません。','成本账请使用完整备份还原预览，不能部分同步'],
 '成本資料的版本保護由完整備份流程管理':['Cost data compatibility is managed through complete backup recovery.','原価データのバージョン保護は完全なバックアップ復元で管理します。','成本数据的版本保护由完整备份流程管理'],
 '這份成本帳的交易請回到店面電腦；原資料與輸入已保留':['Use the shop computer for this transaction. Your records and input are kept.','この取引は店舗のパソコンで操作してください。元の記録と入力は保持されています。','这份成本账的交易请回到店面电脑；原数据与输入已保留'],
}
export default Object.fromEntries(Object.entries(rows).map(([key,row],index)=>[key,[...row,14000+index]]))
