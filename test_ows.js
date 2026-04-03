import { createWallet } from '@open-wallet-standard/core';

try {
    const evo = createWallet("evo");
    console.log("Returned from createWallet('evo'):", evo);
} catch (e) {
    console.error("Error creating/getting 'evo':", e);
}

// Let's also check what else is exported
import * as ows from '@open-wallet-standard/core';
console.log("Exports:", Object.keys(ows));

