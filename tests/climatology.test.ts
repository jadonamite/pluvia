import {describe,it,expect} from 'vitest';
import {calibrate} from '../scripts/climatology.js';
import {windowDates} from '../app/domain/series.js';
describe('prior-year calibration',()=>{
 it('uses complete matching prior windows and never the claim year',()=>{const daily:Record<string,number>={};for(let year=2015;year<=2025;year++)for(const d of windowDates({start:`${year}-07-01`,end:`${year}-07-31`}))daily[d.replace(/-/g,'')]=year===2025?999:10;const result=calibrate({daily,window:{start:'2025-07-01',end:'2025-07-31'},beforeYear:2025});expect(result.annual_totals).toHaveLength(10);expect(result.median_mm).toBe(310);expect(result.trigger_mm).toBe(217);expect(result.exit_mm).toBe(93);});
 it('rejects sparse/fill windows instead of calibrating on partial sums',()=>{const daily:Record<string,number>={};for(let year=2015;year<=2024;year++)for(const d of windowDates({start:`${year}-07-01`,end:`${year}-07-31`}))daily[d.replace(/-/g,'')]=10;for(const year of [2015,2016,2017])daily[`${year}0701`]=-999;expect(()=>calibrate({daily,window:{start:'2025-07-01',end:'2025-07-31'},beforeYear:2025})).toThrow('eight complete');});
});
