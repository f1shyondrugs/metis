export function desktopShortcutFromEvent(event: {
  key:string;code:string;ctrlKey:boolean;altKey:boolean;shiftKey:boolean;metaKey:boolean;repeat?:boolean;isComposing?:boolean;
}) {
  if (event.repeat || event.isComposing || ["Control","Alt","Shift","Meta","AltGraph"].includes(event.key)) return null;
  const key=/^Key[A-Z]$/.test(event.code)?event.code.slice(3):/^Digit[0-9]$/.test(event.code)?event.code.slice(5):event.code==="Space"?"Space":event.key;
  return [event.ctrlKey&&"Control",event.altKey&&"Alt",event.shiftKey&&"Shift",event.metaKey&&"Super",key].filter(Boolean).join("+");
}
export function desktopShortcutLabel(value:string, platform?:string) {
  return value.split("+").map(key=>({Control:"Ctrl",Super:platform==="darwin"?"Cmd":"Win",Escape:"Esc"})[key]||key).join(" + ");
}
