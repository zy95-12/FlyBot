// One shared load per mounted workbench; callers still fence their own scope.
export function nativeAssetLoader(doc, win) {
  let loading
  return () => {
    if (loading) return loading
    if (win.FlyBotNativeConversation) return Promise.resolve()
    loading = new Promise((resolve, reject) => {
      let styled = false, scripted = false
      const ready = () => { if (styled && scripted) resolve() }
      const css = doc.createElement('link'); css.rel = 'stylesheet'; css.href = '/workbench-native.css'
      css.onload = () => { styled = true; ready() }
      css.onerror = () => reject(new Error('Original conversation styles could not load'))
      doc.head.append(css)
      const script = doc.createElement('script'); script.src = '/workbench-native.js'
      script.onload = () => { scripted = true; ready() }; script.onerror = () => reject(new Error('Original conversation components could not load'))
      doc.head.append(script)
    })
    return loading
  }
}
