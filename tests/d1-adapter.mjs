import { DatabaseSync } from 'node:sqlite';
export function createD1(schema) {
 const db = new DatabaseSync(':memory:'); db.exec(schema);
 class Statement {
  constructor(query,params=[]) {this.query=query;this.params=params;}
  bind(...params) {return new Statement(this.query,params);}
  async first(column) {const row=db.prepare(this.query).get(...this.params);return row?(column?row[column]:{...row}):null;}
  async all() {return {success:true,results:db.prepare(this.query).all(...this.params).map(row=>({...row})),meta:{}};}
  async run() {const result=db.prepare(this.query).run(...this.params);return {success:true,results:[],meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};}
 }
 return {prepare(query){return new Statement(query);},async batch(statements){db.exec('BEGIN');try{const result=[];for(const s of statements){const prepared=db.prepare(s.query);if(prepared.columns().length){result.push({success:true,results:prepared.all(...s.params).map(row=>({...row})),meta:{changes:0}});}else{const row=prepared.run(...s.params);result.push({success:true,results:[],meta:{changes:Number(row.changes),last_row_id:Number(row.lastInsertRowid)}});}}db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}},raw:db,close(){db.close();}};
}
