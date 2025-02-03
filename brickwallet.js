var brick_wallet = {
    state: {
        last_tx: 1,
        offset: 0,
        history: {},
        selected_currencies: [],
        supported_currencies: [],
    },
    loaded: false,
    waitSomeTime: async milliseconds => new Promise( resolve => setTimeout( resolve, milliseconds ) ),
    getInvoicePmthash: invoice => {
        var decoded = bolt11.decode( invoice );
        var i; for ( i=0; i<decoded[ "tags" ].length; i++ ) {
            if ( decoded[ "tags" ][ i ][ "tagName" ] == "payment_hash" ) var pmthash = decoded[ "tags" ][ i ][ "data" ].toString();
        }
        return pmthash;
    },
    getInvoiceDescription: invoice => {
        var desc = ``;
        var decoded = bolt11.decode( invoice );
        var i; for ( i=0; i<decoded[ "tags" ].length; i++ ) {
            if ( decoded[ "tags" ][ i ][ "tagName" ] == "description" ) desc = decoded[ "tags" ][ i ][ "data" ].toString();
        }
        return desc;
    },
    hexToText: hex => {
        var bytes = new Uint8Array( Math.ceil( hex.length / 2 ) );
        var i; for ( i=0; i<hex.length; i++ ) bytes[ i ] = parseInt( hex.substr( i * 2, 2 ), 16 );
        var text = new TextDecoder().decode( bytes );
        return text;
    },
    textToHex: text => {
        var encoded = new TextEncoder().encode( text );
        return Array.from( encoded )
            .map( x => x.toString( 16 ).padStart( 2, "0" ) )
            .join( "" );
    },
    init: async () => {
        if ( brick_wallet.loaded ) await brick_wallet.waitSomeTime( 3000 );
        if ( Object.keys( brick_wallet.state.history ).length ) {
            if ( !brick_wallet.loaded ) brick_wallet.parseHistory();
        } else {
            if ( brick_wallet.loaded ) $( '.history' ).innerText = 'No history';
        }
        brick_wallet.loaded = true;
        var until = brick_wallet.state.last_tx;
        var delay_tolerance = 10;
        var limit = 10;
        var txs = [];
        brick_wallet.parseHistory();
        brick_wallet.init();
    },
    parseHistory: () => {
        var history = [];
        Object.keys( brick_wallet.state.history ).forEach( txid => history.push( brick_wallet.state.history[ txid ] ) );
        history.sort( ( a, b ) => b[ "settled_at" ] - a[ "settled_at" ] );
        var remove_before = brick_wallet.state.offset * 5;
        history.splice( 0, remove_before );
        history.length = 5;
        var html = ``;
        if ( history.length ) {
            $( '.hist_btns' ).classList.remove( "hidden" );
            var len_of_hist = Object.keys( brick_wallet.state.history ).length;
            if ( ( brick_wallet.state.offset + 1 ) * 5 >= len_of_hist ) $( '.hist_fwd' ).disabled = true;
            else $( '.hist_fwd' ).disabled = false;
            if ( !brick_wallet.state.offset ) $( '.hist_back' ).disabled = true;
            else $( '.hist_back' ).disabled = false;
            if ( brick_wallet.state.offset < 0 ) brick_wallet.state.offset = 0;
            $( '.hist_fwd' ).onclick = () => {
                if ( $( '.hist_fwd' ).disabled ) return;
                var len_of_hist = Object.keys( brick_wallet.state.history ).length;
                if ( ( brick_wallet.state.offset + 2 ) * 5 >= len_of_hist ) $( '.hist_fwd' ).disabled = true;
                $( '.hist_back' ).disabled = false;
                brick_wallet.state.offset = brick_wallet.state.offset + 1;
                brick_wallet.parseHistory();
            }
            $( '.hist_back' ).onclick = () => {
                if ( $( '.hist_back' ).disabled ) return;
                $( '.hist_fwd' ).disabled = false;
                brick_wallet.state.offset = brick_wallet.state.offset - 1;
                if ( brick_wallet.state.offset < 0 ) brick_wallet.state.offset = 0;
                if ( !brick_wallet.state.offset ) $( '.hist_back' ).disabled = true;
                brick_wallet.parseHistory();
            }
        }
        history.forEach( tx => {
            if ( !tx ) return;
            var txid = tx[ "payment_hash" ];
            var invoice;
            if ( "invoice" in tx ) invoice = tx[ "invoice" ];
            if ( "bolt11" in tx ) invoice = tx[ "bolt11" ];
            if ( $( '.invoice_box' ) && $( '.invoice_box' ).innerText === invoice ) {
                if ( !$( '.modal' ).classList.contains( "hidden" ) ) $( '.x_modal' ).click();
                $( '.invoice_box' ).innerText = "";
            }
            var arrow = `<span class="noselect arrow incoming_arrow">&#8601;</span>`;
            var incoming_or_outgoing = "incoming_tx";
            if ( tx[ "type" ] === "outgoing" ) {
                arrow = `<span class="noselect arrow outgoing_arrow">&#8599;</span>`;
                incoming_or_outgoing = "outgoing_tx";
            }
            var desc_div = `
                <div class="tx_detail_big">
                    <p style="font-weight: bold;">Description</p>
                    <p class="desc_div"></p>
                </div>
            `;
            var pmthash_div = "";
            if ( "payment_hash" in tx && tx[ "payment_hash" ] ) pmthash_div = `
                <div class="tx_detail_big">
                    <p style="font-weight: bold;">Payment hash</p>
                    <p>${tx[ "payment_hash" ]}</p>
                </div>
            `;
            var invoice_div = "";
            if ( "invoice" in tx && tx[ "invoice" ] ) invoice_div = `
                <div class="tx_detail_big">
                    <p style="font-weight: bold;">Invoice</p>
                    <p>${tx[ "invoice" ]}</p>
                </div>
            `;
            if ( "bolt11" in tx && tx[ "bolt11" ] ) invoice_div = `
                <div class="tx_detail_big">
                    <p style="font-weight: bold;">Invoice</p>
                    <p>${tx[ "bolt11" ]}</p>
                </div>
            `;
            var preimage_div = "";
            if ( "preimage" in tx && tx[ "preimage" ] ) preimage_div = `
                <div class="tx_detail_big">
                    <p style="font-weight: bold;">Preimage</p>
                    <p>${tx[ "preimage" ]}</p>
                </div>
            `;
            var hidden_or_shown = tx[ "detail_hidden" ] ? "hidden" : "";
            var txdata = `
                <div class="clickable_tx_parent" data-txid="${txid}">
                    <div class="clickable_tx ${incoming_or_outgoing}">
                        ${arrow}
                        <span class="noselect tx_amt" data-sats="${Math.floor( ( tx[ "amount" ] + tx[ "fees_paid" ] ) / 1000 )}">${Math.floor( ( tx[ "amount" ] + tx[ "fees_paid" ] ) / 1000 )} sats</span>
                    </div>
                    <div class="hidable_tx_data ${hidden_or_shown}">
                        <div class="tx_detail">
                            <span>Amount</span><span>${Math.floor( tx[ "amount" ] / 1000 )} sats</span>
                        </div>
                        <div class="tx_detail">
                            <span>Fees</span><span>${Math.floor( tx[ "fees_paid" ] / 1000 )} sats</span>
                        </div>
                        <div class="tx_detail">
                            <span>Time</span><div>${new Date( tx[ "settled_at" ] * 1000 ).toLocaleDateString( "en-CA" ) + "<br>" + new Date( tx[ "settled_at" ] * 1000 ).toLocaleTimeString()}</div>
                        </div>
                        ${desc_div}
                        ${pmthash_div}
                        ${preimage_div}
                        ${invoice_div}
                    </div>
                </div>
            `;
            html = html + txdata;
        });
        var div = document.createElement( "div" );
        div.innerHTML = html;
        history.forEach( ( tx, index ) => {
            if ( !tx ) return;
            div.getElementsByClassName( "desc_div" )[ index ].innerText = tx[ "description" ] || "[No description]"
        });
        $( '.history' ).innerHTML = '';
        $( '.history' ).append( div );
        $$( '.clickable_tx' ).forEach( item => {
            item.onclick = () => {
                var parent = item.parentElement;
                var txid = parent.getAttribute( "data-txid" );
                var hidable = parent.getElementsByClassName( "hidable_tx_data" )[ 0 ];
                if ( !hidable.classList.contains( "hidden" ) ) {
                    brick_wallet.state.history[ txid ][ "detail_hidden" ] = true;
                    hidable.classList.add( "hidden" );
                } else {
                    brick_wallet.state.history[ txid ][ "detail_hidden" ] = false;
                    hidable.classList.remove( "hidden" );
                }
            }
        });
        balance.setState(()=>{});
    }
}
