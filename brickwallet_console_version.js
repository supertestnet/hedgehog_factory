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
        if ( history.length ) {
            var len_of_hist = Object.keys( brick_wallet.state.history ).length;
            if ( brick_wallet.state.offset < 0 ) brick_wallet.state.offset = 0;
        }
        balance.setState(()=>{});
    }
}