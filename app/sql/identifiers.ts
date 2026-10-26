export function identifier(value:string):string {if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value))throw new Error('Invalid SQL identifier');return value;}
export function literal(value:string):string {if(/[\r\n]/.test(value))throw new Error('Invalid SQL literal');return `'${value.replace(/'/g,"''")}'`;}
