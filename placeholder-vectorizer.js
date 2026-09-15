(() => {
  'use strict';

  const MAX_DIMENSION = 192;
  const MAX_PIXELS = 192 * 192;
  const MAX_SVG_BYTES = 15000;

  const isPng = file => {
    const type=String(file?.type||'').toLowerCase();
    const ext=String(file?.name||'').split('.').pop()?.toLowerCase()||'';
    return type==='image/png'||ext==='png';
  };
  const hex2 = n => Number(n).toString(16).padStart(2,'0');
  const fileKey = file => [file?.name||'',file?.size||0,file?.lastModified||0].join(':');

  async function decode(file){
    if(!file)throw new Error('Choose a PNG first.');
    if(!isPng(file))return {eligible:false,reason:'Auto-convert currently supports PNG files only.'};
    let bitmap;
    try{
      bitmap=await createImageBitmap(file);
      const width=Number(bitmap.width),height=Number(bitmap.height);
      if(!width||!height)return {eligible:false,reason:'PNG dimensions could not be read.'};
      if(width>MAX_DIMENSION||height>MAX_DIMENSION||width*height>MAX_PIXELS){
        return {eligible:false,width,height,reason:`PNG is ${width}×${height}. Auto-convert is limited to small images up to ${MAX_DIMENSION}×${MAX_DIMENSION}.`};
      }
      const canvas=document.createElement('canvas');
      canvas.width=width;canvas.height=height;
      const ctx=canvas.getContext('2d',{alpha:true,willReadFrequently:true});
      ctx.clearRect(0,0,width,height);
      ctx.drawImage(bitmap,0,0);
      return {eligible:true,width,height,data:ctx.getImageData(0,0,width,height).data};
    }finally{bitmap?.close?.();}
  }

  function traceRuns(width,height,data){
    const groups=new Map();
    const pixel=(x,y)=>{
      const i=(y*width+x)*4;
      return [data[i],data[i+1],data[i+2],data[i+3]];
    };
    const same=(a,b)=>a[0]===b[0]&&a[1]===b[1]&&a[2]===b[2]&&a[3]===b[3];
    for(let y=0;y<height;y++){
      let x=0;
      while(x<width){
        const rgba=pixel(x,y);
        let end=x+1;
        while(end<width&&same(rgba,pixel(end,y)))end++;
        if(rgba[3]>0){
          const key=rgba.join(',');
          const group=groups.get(key)||{rgba,runs:[]};
          group.runs.push([x,y,end-x]);
          groups.set(key,group);
        }
        x=end;
      }
    }
    const parts=[`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`];
    for(const {rgba,runs} of groups.values()){
      const [r,g,b,a]=rgba;
      const opacity=a===255?'':` fill-opacity="${(a/255).toFixed(4).replace(/0+$/,'').replace(/\.$/,'')}"`;
      const d=runs.map(([x,y,w])=>`M${x} ${y}h${w}v1h-${w}z`).join('');
      parts.push(`<path fill="#${hex2(r)}${hex2(g)}${hex2(b)}"${opacity} d="${d}"/>`);
    }
    parts.push('</svg>');
    return parts.join('');
  }

  async function convert(file){
    const decoded=await decode(file);
    if(!decoded.eligible)return {...decoded,converted:false};
    const svg=traceRuns(decoded.width,decoded.height,decoded.data);
    const svgBytes=new TextEncoder().encode(svg).length;
    if(svgBytes>MAX_SVG_BYTES){
      return {
        converted:false,eligible:false,width:decoded.width,height:decoded.height,svgBytes,
        reason:`The lossless SVG trace would be ${(svgBytes/1024).toFixed(1)} KB, which is too complex for the onchain placeholder budget. The original PNG will be kept.`
      };
    }
    const base=String(file.name||'placeholder.png').replace(/\.png$/i,'')||'placeholder';
    const svgFile=new File([svg],`${base}.vector.svg`,{type:'image/svg+xml',lastModified:Date.now()});
    return {
      converted:true,eligible:true,width:decoded.width,height:decoded.height,svgBytes,
      sourceBytes:Number(file.size||0),file:svgFile,key:fileKey(file),
      reason:`Converted ${decoded.width}×${decoded.height} PNG to ${(svgBytes/1024).toFixed(1)} KB SVG.`
    };
  }

  window.RelicForgePlaceholderVectorizer=Object.freeze({
    version:'r12v2-placeholder-vector1',
    maxDimension:MAX_DIMENSION,
    maxSvgBytes:MAX_SVG_BYTES,
    isPng,fileKey,convert
  });
})();
