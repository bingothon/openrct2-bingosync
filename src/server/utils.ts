// src/server/utils.ts
import { OpenRCT2Options } from '../types/options';

export function parseArgs(args: string[], defaults: OpenRCT2Options): OpenRCT2Options {
    const parsed: Record<string, any> = { ...defaults };

    args.forEach((arg, i) => {
        if (arg.startsWith('--')) {
            const key = arg.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            const next = args[i + 1];
            parsed[key] = next && !next.startsWith('--') ? isNaN(Number(next)) ? next : Number(next) : true;
        }
    });

    return parsed as OpenRCT2Options; // Cast to the correct type
}


export function generatePassphrase(length = 8): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
}


// Matches room ID from the response data
export function roomMatcher(data: string): string | null {
    const match = data.match(/window\.sessionStorage\.setItem\(["']room["'],\s*["']([a-zA-Z0-9-_]+)["']\);/s);
    return match ? match[1] : null;
}
