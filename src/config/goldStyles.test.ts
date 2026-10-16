import { readFileSync } from 'node:fs';
import { parse, type Rule } from 'postcss';
import { afterEach, describe, expect, it } from 'vitest';
import { cigarTheme } from './theme';

const css = parse(readFileSync('src/style.css', 'utf8'));
const rules: Rule[] = [];
css.walkRules(rule => { rules.push(rule); });
const declaration = (rule: Rule, property: string) => rule.nodes.find(node => node.type === 'decl' && node.prop === property);
const selector = '.ant-switch.ant-switch-checked:not(.ant-switch-disabled):not(:disabled)';
const tabSelector = '.ant-tabs .ant-tabs-tab.ant-tabs-tab-active:not(.ant-tabs-tab-disabled) .ant-tabs-tab-btn';
afterEach(() => document.body.replaceChildren());

describe('shared brand gold styles', () => {
  it('uses shared gradient variables for Switch base, hover and pressed states', () => {
    for (const [suffix, variable] of [['', '--cigar-gradient-gold'], [':hover', '--cigar-gradient-gold-hover'], [':active', '--cigar-gradient-gold-active']]) {
      const rule = rules.find(rule => rule.selector === selector + suffix)!;
      expect(declaration(rule, 'background')).toMatchObject({ value: `var(${variable})`, important: true });
      expect(declaration(rule, 'outline')).toBeUndefined();
    }
  });
  it('styles ordinary and legacy-class checked switches, never disabled or off switches', () => {
    const button = document.createElement('button'); document.body.append(button);
    button.className = 'ant-switch ant-switch-checked'; expect(button.matches(selector)).toBe(true);
    button.classList.add('gold-switch'); expect(button.matches(selector)).toBe(true);
    button.disabled = true; expect(button.matches(selector)).toBe(false);
    button.disabled = false; button.classList.add('ant-switch-disabled'); expect(button.matches(selector)).toBe(false);
    button.className = 'ant-switch'; expect(button.matches(selector)).toBe(false);
  });
  it('applies selected tab accents without the equal-width layout class and excludes disabled tabs', () => {
    const tabs = document.createElement('div'); tabs.className = 'ant-tabs';
    tabs.innerHTML = '<div class="ant-tabs-tab ant-tabs-tab-active"><div class="ant-tabs-tab-btn">Hours</div></div>';
    document.body.append(tabs);
    const label = tabs.querySelector('.ant-tabs-tab-btn')!;
    expect(label.matches(tabSelector)).toBe(true);
    label.parentElement!.classList.add('ant-tabs-tab-disabled'); expect(label.matches(tabSelector)).toBe(false);
    expect(rules.some(rule => rule.selector === tabSelector && declaration(rule, 'color')?.type === 'decl')).toBe(true);
    expect(declaration(rules.find(rule => rule.selector === '.ant-tabs .ant-tabs-ink-bar')!, 'background'))
      .toMatchObject({ value: 'var(--cigar-gradient-gold)' });
  });
  it('keeps gradient text behind feature detection with a readable solid fallback', () => {
    const fallback = rules.find(rule => rule.selector === tabSelector && rule.parent?.type === 'root')!;
    expect(declaration(fallback, 'color')).toMatchObject({ value: '#FDE08D' });
    const clipped = rules.find(rule => rule.selector === tabSelector && rule.parent?.type === 'atrule')!;
    expect(clipped.parent).toMatchObject({ name: 'supports' });
    expect(declaration(clipped, 'background-image')).toMatchObject({ value: 'var(--cigar-gradient-gold)' });
  });
  it('retains semantic colors and solid theme fallbacks', () => {
    expect(cigarTheme.token).toMatchObject({ colorSuccess: '#52c41a', colorWarning: '#faad14', colorError: '#ff4d4f' });
    expect(cigarTheme.components?.Switch).toMatchObject({ colorPrimary: '#C48D3A', colorPrimaryHover: '#D4A050' });
    expect(cigarTheme.components?.Tabs).toMatchObject({ itemSelectedColor: '#FDE08D', inkBarColor: '#C48D3A' });
  });
});
