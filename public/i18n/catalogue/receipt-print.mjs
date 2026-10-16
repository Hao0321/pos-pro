const rows={
 '列印收據':['Print receipt','レシートを印刷','打印收据'],
 '收據請到店面電腦列印。':['Print this receipt from the store PC.','レシートは店舗PCから印刷してください。','收据请到门店电脑打印。'],
 '收據列印待核對，請先查看印表機。':['Check the printer; the receipt print result is uncertain.','印刷結果が不明です。先にプリンターを確認してください。','收据打印待核对，请先查看打印机。'],
 '結帳已完成，不需再次收款。':['Payment is complete. Do not collect payment again.','会計は完了しています。再度代金を受け取らないでください。','结账已完成，无需再次收款。'],
 '可能已印過。請先看紙張，再決定是否補印。':['This may already be printed. Check the paper before reprinting.','すでに印刷済みの可能性があります。用紙を確認してから再印刷してください。','可能已打印过。请先查看纸张，再决定是否补印。'],
 '只印收據，不再次收款。':['This only prints a receipt; it does not take another payment.','レシートの印刷のみで、再度の会計は行いません。','只打印收据，不会再次收款。'],
 '已拿到收據':['I have the receipt','レシートを受け取りました','已拿到收据'],
 '已自行核對紙張':['You checked the paper','用紙を確認しました','已自行核对纸张'],
 '找收據':['Find receipt','レシートを探す','找收据'],
 '關閉收據查詢':['Close receipt search','レシート検索を閉じる','关闭收据查询'],
 '輸入單號或商品':['Enter order ID or product','注文番号または商品を入力','输入单号或商品'],
 '返回收據清單':['Back to receipt list','レシート一覧に戻る','返回收据列表'],
 '收據商品明細':['Receipt items','レシートの商品明細','收据商品明细'],
 '查看收據':['View receipt','レシートを見る','查看收据'],
}
export default Object.fromEntries(Object.entries(rows).map(([key,row],index)=>[key,[...row,22000+index]]))
