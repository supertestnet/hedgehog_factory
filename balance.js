var balance = {
    html: async () => {
        var sats = balance.bal;
        var bal_to_show = sats;
        var currency = balance.currencies[ balance.currency ];
        if ( currency !== "sats" && currency !== "btc" && currency !== "usd" && !( currency in balance.forex ) ) {
            var rate = await balance.getTicker( currency.toUpperCase() );
            balance.forex[ currency ] = rate;
        }
        if ( currency === "usd" ) {
            bal_to_show = balance.satsToDollars( balance.bal );
            bal_to_show = bal_to_show.toFixed( 2 );
            bal_to_show = Number( bal_to_show ).toLocaleString();
            if ( bal_to_show.includes( "." ) && bal_to_show.length - bal_to_show.indexOf( "." ) == 2 ) bal_to_show = bal_to_show + "0";
        }
        if ( currency === "btc" ) {
            bal_to_show = balance.satsToBitcoin( balance.bal );
        }
        if ( currency !== "sats" && currency !== "btc" && currency !== "usd" ) {
            bal_to_show = balance.satsToDollars( balance.bal );
            var USDFNX = balance.forex[ currency ];
            bal_to_show = USDFNX * bal_to_show;
            bal_to_show = bal_to_show.toFixed( 2 );
            bal_to_show = Number( bal_to_show ).toLocaleString();
            if ( bal_to_show.includes( "." ) && bal_to_show.length - bal_to_show.indexOf( "." ) == 2 ) bal_to_show = bal_to_show + "0";
        }
        if ( currency === "sats" ) bal_to_show = Number( bal_to_show ).toLocaleString();
        $$( '.tx_amt' ).forEach( tx_amt => {
            var bal_for_tx_amt = Number( tx_amt.getAttribute( "data-sats" ) );
            if ( currency === "usd" ) {
                bal_for_tx_amt = balance.satsToDollars( bal_for_tx_amt );
                bal_for_tx_amt = bal_for_tx_amt.toFixed( 2 );
                bal_for_tx_amt = Number( bal_for_tx_amt ).toLocaleString();
                if ( bal_for_tx_amt.includes( "." ) && bal_for_tx_amt.length - bal_for_tx_amt.indexOf( "." ) == 2 ) bal_for_tx_amt = bal_for_tx_amt + "0";
            }
            if ( currency === "btc" ) {
                bal_for_tx_amt = balance.satsToBitcoin( bal_for_tx_amt );
            }
            if ( currency !== "sats" && currency !== "btc" && currency !== "usd" ) {
                bal_for_tx_amt = balance.satsToDollars( bal_for_tx_amt );
                var USDFNX = balance.forex[ currency ];
                bal_for_tx_amt = USDFNX * bal_for_tx_amt;
                bal_for_tx_amt = bal_for_tx_amt.toFixed( 2 );
                bal_for_tx_amt = Number( bal_for_tx_amt ).toLocaleString();
                if ( bal_for_tx_amt.includes( "." ) && bal_for_tx_amt.length - bal_for_tx_amt.indexOf( "." ) == 2 ) bal_for_tx_amt = bal_for_tx_amt + "0";
            }
            if ( currency === "sats" ) bal_for_tx_amt = Number( bal_for_tx_amt ).toLocaleString();
            tx_amt.innerText = bal_for_tx_amt + ` ${currency}`
        });
        return `
            <span class="noselect" data-sats_sum="${sats}">${bal_to_show} ${currency}</span>
        `;
    },
    bal: 0,
    currency: 0,
    currencies: [
        "sats",
        "btc",
        "usd",
    ],
    supported_currencies: [
        "eur",
        "gbp",
        "cad",
        "cny",
        "jpy",
        "inr",
        "rub",
        "mxn",
    ],
    forex: {},
    forex_loaded: false,
    price: 0,
    onlongtouch: null,
    longtouchtimer: null,
    touchduration: 800,
    switchCurrency: () => {
        balance.setState(() => balance.currency = ( balance.currency + 1 ) % balance.currencies.length );
    },
    getBitcoinPriceFromCoinbase: async () => {
        var data = await fetch( "https://api.coinbase.com/v2/prices/BTC-USD/spot" );
        data = await data.text();
        var json = JSON.parse( data );
        var price = json[ "data" ][ "amount" ];
        return price;
    },
    getBitcoinPriceFromKraken: async () => {
        var data = await fetch( "https://api.kraken.com/0/public/Ticker?pair=XBTUSD" );
        data = await data.text();
        var json = JSON.parse( data );
        var price = json[ "result" ][ "XXBTZUSD" ][ "a" ][ 0 ];
        return price;
    },
    getBitcoinPriceFromCoindesk: async () => {
        var data = await fetch( "https://api.coindesk.com/v1/bpi/currentprice.json" );
        data = await data.text();
        var json = JSON.parse( data );
        var price = json[ "bpi" ][ "USD" ][ "rate_float" ];
        return price;
    },
    getBitcoinPriceFromGemini: async () => {
        var data = await fetch( "https://api.gemini.com/v2/ticker/BTCUSD" );
        data = await data.text();
        var json = JSON.parse( data );
        var price = json[ "bid" ];
        return price;
    },
    getBitcoinPriceFromCoinGecko: async () => {
        var data = await fetch( "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&precision=2" );
        data = await data.text();
        var json = JSON.parse( data );
        var price = json[ "bitcoin" ][ "usd" ];
        return price;
    },
    getBitcoinPrice: async () => {
        var prices = [];
        var cbprice = await balance.getBitcoinPriceFromCoinbase();
        var kprice = await balance.getBitcoinPriceFromKraken();
        var cdprice = await balance.getBitcoinPriceFromCoindesk();
        var gprice = await balance.getBitcoinPriceFromGemini();
        var cgprice = await balance.getBitcoinPriceFromCoinGecko();
        prices.push( Number( cbprice ), Number( kprice ), Number( cdprice ), Number( gprice ), Number( cgprice ) );
        prices.sort();
        return prices[ 2 ];
    },
    getPrice: async () => {
        balance.price = await balance.getBitcoinPrice();
        await brick_wallet.waitSomeTime( 15_000 );
        balance.getPrice();
    },
    getTicker: async ticker => {
        var url = `https://assets.ino.com/data/quote/?format=json&s=FOREX_USD${ticker}`;
        var data = await fetch( url );
        var json = await data.json();
        return Number( json[ `FOREX_USD${ticker}` ][ "last" ] );
    },
    satsToDollars: sats => {
        if ( sats >= 100000000 ) sats = sats * 10;
        var value_in_dollars = Number( String( sats ).padStart( 8, "0" ).slice( 0,-9 ) + "." + String( sats ).padStart( 8, "0" ).slice( -9 ) ) * balance.price;
        return value_in_dollars;
    },
    satsToBitcoin: sats => {
        var btc = String( sats ).padStart( 8, "0" ).slice( 0,-8 ) + "." + String( sats ).padStart( 8, "0" ).slice( -8 );
        if ( btc.endsWith( "00000" ) ) {
            btc = btc.substring( 0, btc.length - 5 );
            var i; for ( i=0; i<5; i++ ) {
                if ( btc.endsWith( "0" ) ) btc = btc.substring( 0, btc.length - 1 );
            }
            if ( btc.endsWith( "." ) ) btc = btc.substring( 0, btc.length - 1 );
            if ( !btc ) btc = 0;
        }
        return btc;
    },
    setState: (callback) => {
        callback();
        balance.render();
    },
    // calculateBalance: () => {
    //     balance.setState(() => {
    //         var sum = 0;
    //         Object.keys( brick_wallet.state.history ).forEach( txid => {
    //             var tx = brick_wallet.state.history[ txid ];
    //             if ( tx.type === "incoming" ) sum = sum + tx[ "amount" ];
    //             else sum = sum - ( tx[ "amount" ] + tx[ "fees_paid" ] );
    //         });
    //         balance.bal = Math.floor( sum / 1000 );
    //     });
    // },
    addCurrency: item => {
        item.onclick = () => {
            var btn = document.createElement( "button" );
            btn.innerText = item.innerText;
            btn.addEventListener( "click", ()=>{balance.removeCurrency( btn );});
            btn.click();
            $( '.selected_currencies' ).append( btn );
            item.remove();
        }
    },
    removeCurrency: item => {
        item.onclick = () => {
            var btn = document.createElement( "button" );
            btn.innerText = item.innerText;
            btn.addEventListener( "click", ()=>{balance.addCurrency( btn );});
            btn.click();
            $( '.supported_currencies' ).append( btn );
            item.remove();
        }
    },
    modCurrencies: async () => {
        var selected_currencies = [];
        $$( '.selected_currencies button' ).forEach( item => {selected_currencies.push( item.innerText );});
        var supported_currencies = [];
        $$( '.supported_currencies button' ).forEach( item => {supported_currencies.push( item.innerText );});
        balance.currencies = selected_currencies;
        balance.supported_currencies = supported_currencies;
        balance.currency = 0;
        balance.render();
        if ( "selected_currencies" in brick_wallet.state ) brick_wallet.state[ "selected_currencies" ] = [];
        if ( "supported_currencies" in brick_wallet.state ) brick_wallet.state[ "supported_currencies" ] = [];
        brick_wallet.state[ "selected_currencies" ] = selected_currencies;
        brick_wallet.state[ "supported_currencies" ] = supported_currencies;
        var i; for ( i=0; i<balance.currencies.length; i++ ) {
            var currency = balance.currencies[ i ];
            if ( currency !== "sats" && currency !== "btc" && currency !== "usd" && !( currency in balance.forex ) ) {
                var rate = await balance.getTicker( currency.toUpperCase() );
                // console.log( `got rate for ${currency}: 1 usd = ${rate} ${currency}` );
                balance.forex[ currency ] = rate;
                await brick_wallet.waitSomeTime( 2000 );
            }
        }
    },
    render: async () => {
        $( '.balance' ).innerHTML = await balance.html();
        $( '.balance' ).onpointerdown = function() {
            balance.onlongtouch = async () => {
                balance.longtouchtimer = null;
                var html = `
                    <p>Add/remove currencies</p>
                    <p class="selected_currencies"></p>
                    <p>Quick-tapping the price will toggle through the above currencies in order. Add currencies by tapping them in the list below; remove them by tapping them in the list above.</p>
                    <p class="supported_currencies"></p>
                    <p><button class="submit_currencies_form" onclick="balance.modCurrencies();sessionStorage[ 'modal_cleared' ] = true;modalVanish();">Submit</button></p>
                `;
                sessionStorage.removeItem( "modal_cleared" );
                var block_til_clear = true;
                showModal( html, block_til_clear );
                balance.currencies.forEach( item => {
                    var btn = document.createElement( "button" );
                    btn.innerText = item;
                    btn.addEventListener( "click", ()=>{balance.removeCurrency( btn );});
                    btn.click();
                    $( '.selected_currencies' ).append( btn );
                });
                balance.supported_currencies.forEach( item => {
                    var btn = document.createElement( "button" );
                    btn.innerText = item;
                    btn.addEventListener( "click", ()=>{balance.addCurrency( btn );});
                    btn.click();
                    $( '.supported_currencies' ).append( btn );
                });
                await hedgehog_factory.getNote( "modal_cleared" );
                delete hedgehog_factory.retrievables[ "modal_cleared" ];
            };
            if ( !balance.longtouchtimer || ( !isNaN( balance.longtouchtimer ) && balance.longtouchtimer != null ) ) {
                balance.longtouchtimer = setTimeout( balance.onlongtouch, balance.touchduration );
            }
        }
        $( '.balance' ).onpointerup = function( e ) {
            if ( balance.longtouchtimer ) clearTimeout( balance.longtouchtimer );
            if ( balance.longtouchtimer ) balance.switchCurrency();
        }
    }
}
