extern crate wasm_bindgen;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn respond(url: String) -> String {
    format!("rust:{}", url)
}
