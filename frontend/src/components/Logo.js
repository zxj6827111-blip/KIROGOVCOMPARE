import React from 'react';
import { Landmark } from 'lucide-react';

const Logo = () => {
    return (
        <div className="logo-container" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
                width: '36px',
                height: '36px',
                background: 'linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)'
            }}>
                <Landmark color="white" size={20} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <h1 style={{
                    fontSize: '16px',
                    fontWeight: '700',
                    color: '#0f172a',
                    margin: 0,
                    lineHeight: '1.2',
                    letterSpacing: '-0.3px'
                }}>
                    政府信息公开
                </h1>
                <span style={{
                    fontSize: '11px',
                    color: '#64748b',
                    fontWeight: '500',
                    letterSpacing: '0.2px',
                    textTransform: 'uppercase'
                }}>
                    年度报告差异比对系统
                </span>
            </div>
        </div>
    );
};

export default Logo;
