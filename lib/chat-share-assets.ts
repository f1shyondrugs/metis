/** Exact mappings for registered chat attachments; never resolve workspace or filesystem paths. */
export function chatShareAssets(chatId:string,shareId:string,messages:readonly {attachments?:readonly {id:string;storedName:string}[]}[]) {
  const assets:Record<string,string>={};
  for(const message of messages)for(const file of message.attachments||[]){
    if(!file.storedName)continue;
    const url="/api/uploads/"+encodeURIComponent(chatId)+"/"+encodeURIComponent(file.storedName);
    const shared="/api/share/attachment?id="+encodeURIComponent(shareId)+"&name="+encodeURIComponent(file.storedName);
    assets[url]=shared;
    assets[url+"?download=1"]=shared+"&download=1";
  }
  return assets;
}
